/**
 * FQ12-SEC: webhook HMAC secrets were stored in plaintext in
 * webhooks.webhooks.secret and webhooks.secret_rotations.new_secret.
 *
 * Proves: secrets are sealed with admin-service's envelope before they are
 * queued or stored; the plaintext is returned once at create and never on a
 * read; signing opens the sealed value; no key -> 503 with nothing published;
 * and the backfill seals legacy plaintext rows idempotently.
 *
 * Every secret value here is generated at runtime (no literals).
 */
import { randomBytes, randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { type Queue, type Handler } from "@civitasone/queue";
import { signToken } from "@civitasone/auth";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { queue as sharedQueue } from "../src/shared/infra.js";
import { webhooks, secretRotations } from "../src/modules/webhooks/schema.js";
import { registerWebhookConsumers } from "../src/modules/webhooks/consumer.js";
import { signPayload } from "../src/modules/webhooks/commands.js";
import { signForWebhook, verifyForWebhook, SECRET_MASK } from "../src/modules/webhooks/secret-store.js";
import { backfillWebhookSecrets, countUnsealedWebhookSecrets } from "../src/modules/webhooks/secret-backfill.js";
import { isSealed, openSecret, sealSecret } from "../src/shared/secret-crypto.js";

const JWT = process.env.JWT_SECRET as string;
const T = randomUUID();
const MAKER = randomUUID();

const fakeSecret = () => `whsec_${randomBytes(32).toString("base64url")}`;

function bearer(actorId: string) {
  return { authorization: `Bearer ${signToken({ sub: actorId, roles: ["super_admin"], tid: T } as never, JWT)}` };
}

async function waitFor<V>(fn: () => Promise<V>, ok: (v: V) => boolean, timeoutMs = 5000): Promise<V> {
  const deadline = Date.now() + timeoutMs;
  let last = await fn();
  while (!ok(last) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 50));
    last = await fn();
  }
  return last;
}

const inTenant = <R>(fn: (tx: any) => Promise<R>) => runWithTenant(T, () => db.transaction((tx) => fn(tx)));

let app: FastifyInstance;
beforeAll(async () => {
  app = await buildApp();
  const raw = sharedQueue.subscribe.bind(sharedQueue);
  (sharedQueue as Queue).subscribe = ((topic: string, h: Handler) => raw(topic, withTenantConsumer(h) as Handler)) as typeof sharedQueue.subscribe;
  registerWebhookConsumers(sharedQueue);
});
afterAll(async () => {
  await inTenant(async (tx) => {
    await tx.delete(secretRotations).where(eq(secretRotations.tenantId, T));
    await tx.delete(webhooks).where(eq(webhooks.tenantId, T));
  });
  await app.close();
  await sqlClient.end();
});

describe("FQ12-SEC webhook secrets are sealed at rest", () => {
  it("create: plaintext returned once, stored sealed, never on a read; signing opens it", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/webhooks", headers: bearer(MAKER),
      payload: { url: "https://example.gov.in/hooks/fq12", events: ["tenant.updated"] },
    });
    expect(res.statusCode).toBe(202);
    const { id, secret } = res.json() as { id: string; secret: string };
    expect(secret).toMatch(/^whsec_/);

    const rows = await waitFor(() => inTenant((tx) => tx.select().from(webhooks).where(eq(webhooks.id, id))), (r) => r.length === 1);
    const row = rows[0]!;
    expect(isSealed(row.secret)).toBe(true);
    expect(row.secret).not.toContain(secret);
    expect(openSecret(row.secret)).toBe(secret);

    const body = JSON.stringify({ event: "tenant.updated", n: 1 });
    expect(signForWebhook(row, body)).toBe(signPayload(secret, body));
    expect(verifyForWebhook(row, body, signPayload(secret, body))).toBe(true);

    const list = await app.inject({ method: "GET", url: "/v1/admin/webhooks", headers: bearer(MAKER) });
    expect(list.statusCode).toBe(200);
    const text = list.body;
    expect(text).not.toContain(secret);
    expect(text).not.toContain(row.secret);
    expect(text).not.toContain("enc:v2:");
    const mine = (list.json() as { data: Array<Record<string, unknown>> }).data.find((w) => w.id === id)!;
    expect(mine.secretMasked).toBe(SECRET_MASK);
    expect(mine).not.toHaveProperty("secret");
    expect(mine).not.toHaveProperty("previousSecret");
  });

  it("rotate request: the pending new_secret is sealed", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/webhooks", headers: bearer(MAKER),
      payload: { url: "https://example.gov.in/hooks/fq12-rot", events: ["tenant.updated"] },
    });
    const { id } = res.json() as { id: string };
    await waitFor(() => inTenant((tx) => tx.select().from(webhooks).where(eq(webhooks.id, id))), (r) => r.length === 1);
    const rot = await app.inject({ method: "POST", url: `/v1/admin/webhooks/${id}/rotate-secret`, headers: bearer(MAKER), payload: {} });
    expect(rot.statusCode).toBe(202);
    const rotationId = (rot.json() as { rotationId: string }).rotationId;
    const rr = await waitFor(() => inTenant((tx) => tx.select().from(secretRotations).where(eq(secretRotations.id, rotationId))), (r) => r.length === 1);
    expect(isSealed(rr[0]!.newSecret)).toBe(true);
    expect(openSecret(rr[0]!.newSecret)).toMatch(/^whsec_/);
  });

  it("no key configured: create answers 503 and nothing is stored", async () => {
    const keep = process.env.PII_ENC_KEY;
    delete process.env.PII_ENC_KEY;
    try {
      const before = await inTenant((tx) => tx.select({ id: webhooks.id }).from(webhooks).where(eq(webhooks.tenantId, T)));
      const res = await app.inject({
        method: "POST", url: "/v1/admin/webhooks", headers: bearer(MAKER),
        payload: { url: "https://example.gov.in/hooks/fq12-nokey", events: ["tenant.updated"] },
      });
      expect(res.statusCode).toBe(503);
      expect(res.json().code).toBe("ENCRYPTION_UNAVAILABLE");
      expect(res.body).not.toMatch(/whsec_/);
      await new Promise((r) => setTimeout(r, 200));
      const after = await inTenant((tx) => tx.select({ id: webhooks.id }).from(webhooks).where(eq(webhooks.tenantId, T)));
      expect(after.length).toBe(before.length);
    } finally {
      process.env.PII_ENC_KEY = keep;
    }
  });
});

describe("FQ12-SEC webhook secret backfill (idempotent)", () => {
  it("seals legacy plaintext rows once, keeps them usable, re-run is a no-op", async () => {
    const plainCurrent = fakeSecret();
    const plainPrevious = fakeSecret();
    const plainPending = fakeSecret();
    const whId = randomUUID();
    const rotId = randomUUID();
    const alreadySealedId = randomUUID();
    const alreadyPlain = fakeSecret();
    const alreadySealed = sealSecret(alreadyPlain);

    await inTenant(async (tx) => {
      await tx.insert(webhooks).values([
        { id: whId, tenantId: T, url: "https://example.gov.in/hooks/legacy", events: ["x"], secret: plainCurrent, previousSecret: plainPrevious, createdBy: MAKER, updatedBy: MAKER },
        { id: alreadySealedId, tenantId: T, url: "https://example.gov.in/hooks/sealed", events: ["x"], secret: alreadySealed, createdBy: MAKER, updatedBy: MAKER },
      ]);
      await tx.insert(secretRotations).values({ id: rotId, tenantId: T, webhookId: whId, newSecret: plainPending, requestedBy: MAKER });
    });

    // The test role is RLS-bound, so run the backfill inside the tenant scope;
    // production runs it as the RLS-bypassing owner (see the script header).
    const first = await inTenant((tx) => backfillWebhookSecrets(tx));
    expect(first.sealed).toBeGreaterThanOrEqual(3);
    expect(first.decryptErrors).toEqual([]);
    expect(await inTenant((tx) => countUnsealedWebhookSecrets(tx))).toBe(0);

    const [wh] = await inTenant((tx) => tx.select().from(webhooks).where(eq(webhooks.id, whId)));
    const [rot] = await inTenant((tx) => tx.select().from(secretRotations).where(eq(secretRotations.id, rotId)));
    const [sealedRow] = await inTenant((tx) => tx.select().from(webhooks).where(eq(webhooks.id, alreadySealedId)));
    expect(isSealed(wh!.secret) && isSealed(wh!.previousSecret!) && isSealed(rot!.newSecret)).toBe(true);
    expect(openSecret(wh!.secret)).toBe(plainCurrent);
    expect(openSecret(wh!.previousSecret!)).toBe(plainPrevious);
    expect(openSecret(rot!.newSecret)).toBe(plainPending);
    expect(sealedRow!.secret).toBe(alreadySealed); // already-sealed value untouched
    const body = "{}";
    expect(signForWebhook(wh!, body)).toBe(signPayload(plainCurrent, body));

    const second = await inTenant((tx) => backfillWebhookSecrets(tx));
    expect(second.sealed).toBe(0);
    expect(second.decryptErrors).toEqual([]);
    const [again] = await inTenant((tx) => tx.select().from(webhooks).where(eq(webhooks.id, whId)));
    expect(again!.secret).toBe(wh!.secret);
  });

  it("reports (does not rewrite) a sealed value that does not open with the configured key", async () => {
    const id = randomUUID();
    const foreign = sealSecret(fakeSecret());
    const keep = process.env.PII_ENC_KEY;
    await inTenant((tx) => tx.insert(webhooks).values({ id, tenantId: T, url: "https://example.gov.in/hooks/foreign", events: ["x"], secret: foreign, createdBy: MAKER, updatedBy: MAKER }));
    process.env.PII_ENC_KEY = randomBytes(24).toString("hex"); // a different key
    try {
      const r = await inTenant((tx) => backfillWebhookSecrets(tx));
      expect(r.decryptErrors.some((e) => e.id === id && e.column === "secret")).toBe(true);
    } finally {
      process.env.PII_ENC_KEY = keep;
    }
    const [row] = await inTenant((tx) => tx.select().from(webhooks).where(eq(webhooks.id, id)));
    expect(row!.secret).toBe(foreign);
  });
});
