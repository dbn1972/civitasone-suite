/**
 * GAP-VISITOR-ADMIN-01 -- applying a vertical preset overwrites tenant-wide DPDP
 * retention / erasure SLA / auto-approval / anti-passback in one call. The server
 * must (a) refuse it without a stated reason, (b) carry that reason into the
 * audit event, (c) let the UI preview the values (GET) before confirming, and
 * (d) actually apply a SECOND preset over a first one (the old messageId was
 * derived from the entry id, so any re-write of a key was dropped as
 * "already processed").
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import { buildApp } from "../src/app.js";
import { db } from "../src/shared/db.js";
import { scannerDb } from "../src/shared/scanner-db.js";
import { outboxMessages } from "../src/shared/outbox.js";
import { queue } from "../src/shared/infra.js";
import { configEntries } from "../src/modules/config-registry/schema.js";
import { registerConfigRegistryConsumers } from "../src/modules/config-registry/consumer.js";
import * as presets from "../src/modules/config-registry/presets.js";
import { POLICY_NS } from "../src/modules/config-registry/policy.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const ACTOR = randomUUID();

function headers(roles: string[]) {
  const token = signToken({ sub: ACTOR, tid: TENANT, roles, sid: "sess-va01" }, SECRET, 3600);
  return { authorization: `Bearer ${token}`, "x-tenant-id": TENANT };
}

async function drain() {
  await (queue as unknown as { drain: () => Promise<void> }).drain();
}

async function retentionDays(): Promise<unknown> {
  const rows = await runWithTenant(TENANT, () =>
    db.transaction((tx) =>
      tx.select().from(configEntries).where(eq(configEntries.tenantId, TENANT)),
    ),
  );
  return rows.find((r) => r.namespace === POLICY_NS && r.configKey === "retention.pii_days")?.value;
}

beforeAll(() => {
  const raw = queue.subscribe.bind(queue);
  (queue as unknown as { subscribe: unknown }).subscribe = (topic: string, handler: (msg: any) => Promise<void>) =>
    raw(topic, (msg: any) => runWithTenant(msg.tenantId, () => handler(msg)) as Promise<void>);
  registerConfigRegistryConsumers(queue);
});

afterAll(async () => {
  await drain();
  await scannerDb.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
  await runWithTenant(TENANT, () =>
    db.transaction((tx) => tx.delete(configEntries).where(eq(configEntries.tenantId, TENANT))),
  );
});

describe("preset application needs a reason (GAP-VISITOR-ADMIN-01)", () => {
  it("400s POST /config/presets/:preset with no reason and applies nothing", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/visitor/config/presets/hospital", headers: headers(["tenant_admin"]),
    });
    await app.close();
    expect(res.statusCode).toBe(400);
    await drain();
    expect(await retentionDays()).toBeUndefined();
  });

  it("400s a reason shorter than 10 characters", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/visitor/config/presets/hospital", headers: headers(["tenant_admin"]),
      payload: { reason: "short" },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("previews a preset's values (GET) for the diff, and rejects an unknown preset", async () => {
    const app = await buildApp();
    const ok = await app.inject({ method: "GET", url: "/v1/visitor/config/presets/hospital", headers: headers(["tenant_admin"]) });
    const bad = await app.inject({ method: "GET", url: "/v1/visitor/config/presets/nope", headers: headers(["tenant_admin"]) });
    const denied = await app.inject({ method: "GET", url: "/v1/visitor/config/presets/hospital", headers: headers(["employee"]) });
    await app.close();
    expect(ok.statusCode).toBe(200);
    const pii = ok.json().entries.find((e: { configKey: string }) => e.configKey === "retention.pii_days");
    expect(pii.value).toBe(1825);
    expect(bad.statusCode).toBe(400);
    expect(denied.statusCode).toBe(403);
  });
});

describe("applying presets end to end (GAP-VISITOR-ADMIN-01)", () => {
  it("applies the preset and records the reason in the audit event", async () => {
    const ctx = { tenantId: TENANT, actorId: ACTOR, correlationId: randomUUID(), roles: ["tenant_admin"] } as never;
    await presets.applyPreset(ctx, "secretariat", "Onboarding a high-security office");
    await drain();
    expect(await retentionDays()).toBe(180);
    const audits = await scannerDb.select().from(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
    const withReason = audits.filter((r) => {
      const pl = typeof r.payload === "string" ? JSON.parse(r.payload) : r.payload;
      return typeof pl?.reason === "string" && pl.reason.includes("Onboarding a high-security office");
    });
    expect(withReason.length).toBeGreaterThan(0);
  });

  it("applies a second preset OVER the first (retention 180 -> 1825)", async () => {
    const ctx = { tenantId: TENANT, actorId: ACTOR, correlationId: randomUUID(), roles: ["tenant_admin"] } as never;
    await presets.applyPreset(ctx, "hospital", "Switching to the hospital policy");
    await drain();
    expect(await retentionDays()).toBe(1825);
  });
});
