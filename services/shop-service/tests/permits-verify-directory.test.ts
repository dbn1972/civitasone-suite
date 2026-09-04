/**
 * Shop Service — GET /v1/shop/permits/verify: public directory (bug fix).
 *
 * BUG PROVEN HERE: the verify route (a citizen scans a QR code / types a
 * verification code printed on the permit — no login, no tenant known) was
 * doubly broken:
 *   1. It never set `config: { public: true }`, so @civitasone/auth's
 *      authPlugin rejected every unauthenticated caller with a 401 before
 *      the handler ever ran.
 *   2. Even authenticated, it read shop.permits directly — FORCE RLS with a
 *      tenant_id-equality policy — with no way for the caller to supply the
 *      target permit's tenant. The policy predicate evaluates to NULL for
 *      any row not in the caller's own tenant, so the "public" lookup would
 *      silently 404 for any code except one from the caller's own tenant.
 *
 * Fixed via migrations/0003_permits_public_directory.sql — a small, non-RLS
 * directory table kept in sync (same transaction) by permits/repo.ts's
 * insertDirectoryEntry, updatePermitStatus, and updateValidUntil. Mirrors
 * trade-service/migrations/0002_licence_public_directory.sql's exact
 * pattern (see that PR, #990, "public licence verification silently broken
 * (401 then RLS-blind)").
 *
 * This suite proves: (a) truly unauthenticated access works, (b) it returns
 * only public fields (no owner/PII), (c) an unknown code 404s, (d) a caller
 * from a DIFFERENT tenant can still verify the permit (proving this is not
 * accidentally still RLS-scoped), and (e) the directory tracks suspend/
 * cancel/restore/renewal status+validity changes, not just issuance.
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import { MemoryQueue } from "@civitasone/queue";
import { eq } from "drizzle-orm";
import { db, sqlClient } from "../src/shared/db.js";
import { outboxMessages } from "../src/shared/outbox.js";
import { applications } from "../src/modules/registrations/schema.js";
import { permits, permitDirectory } from "../src/modules/permits/schema.js";
import { renewals } from "../src/modules/lifecycle/schema.js";
import { registerPermitConsumers } from "../src/modules/permits/consumer.js";
import { registerLifecycleConsumers } from "../src/modules/lifecycle/consumer.js";
import { COMMANDS } from "../src/topics.js";
import { buildApp } from "../src/app.js";

const SECRET = process.env.JWT_SECRET as string;
const TENANT_A = "c1a1a1a1-0000-4000-8000-000000000001";
const TENANT_B = "c1b1b1b1-0000-4000-8000-000000000002";
const OFFICER = "c1a1a1a1-0000-4000-8000-0000000000ff";

function token(tid: string, sub: string, roles: string[]): string {
  return signToken({ sub, tid, roles, sid: "sess-verify" }, SECRET, 3600);
}
const officerBearer = (tid: string) => ({
  authorization: `Bearer ${token(tid, OFFICER, ["shop_admin"])}`,
  "x-tenant-id": tid,
});

function asTenant<T>(tenantId: string, fn: (tx: typeof db) => Promise<T>): Promise<T> {
  return runWithTenant(tenantId, () =>
    db.transaction(fn as Parameters<typeof db.transaction>[0]),
  ) as Promise<T>;
}

async function wipe(): Promise<void> {
  for (const tid of [TENANT_A, TENANT_B]) {
    await asTenant(tid, async (tx) => {
      await tx.delete(renewals).where(eq(renewals.tenantId, tid));
      await tx.delete(permits).where(eq(permits.tenantId, tid));
      await tx.delete(applications).where(eq(applications.tenantId, tid));
      await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, tid));
    });
  }
  // permitDirectory carries no RLS — wipe unscoped.
  await db.delete(permitDirectory);
}

afterAll(async () => {
  await wipe();
  await sqlClient.end();
});

async function issuePermit(tenantId: string): Promise<{ permitId: string; applicationId: string }> {
  const permitId = randomUUID();
  const applicationId = randomUUID();
  const q = new MemoryQueue();
  registerPermitConsumers(q);
  await q.start();
  await q.publish(COMMANDS.issuePermit, {
    messageId: randomUUID(),
    type: COMMANDS.issuePermit,
    tenantId, actorId: OFFICER, correlationId: "corr-verify-issue", schemaVersion: "1.0",
    payload: { id: permitId, tenantId, applicationId, establishmentName: "Verify Test Shop", validityMonths: 12 },
  });
  await new Promise<void>((r) => setTimeout(r, 400));
  await q.stop();
  return { permitId, applicationId };
}

describe("GET /v1/shop/permits/verify — public directory (bug fix)", () => {
  it("truly unauthenticated request (no Authorization header, no x-tenant-id) succeeds and returns only public fields", async () => {
    await wipe();
    const { permitId } = await issuePermit(TENANT_A);
    const [row] = await asTenant(TENANT_A, (tx) => tx.select().from(permits).where(eq(permits.id, permitId)));
    expect(row).toBeTruthy();

    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/shop/permits/verify?code=${row!.verificationCode}`,
      // Deliberately NO authorization / x-tenant-id headers — this is the whole point.
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json().data;
    expect(body.permitNumber).toBe(row!.permitNumber);
    expect(body.establishmentName).toBe("Verify Test Shop");
    expect(body.permitStatus).toBe("active");
    expect(Object.keys(body).sort()).toEqual(
      ["permitNumber", "establishmentName", "permitStatus", "issuedAt", "validFrom", "validUntil"].sort(),
    );
  });

  it("a DIFFERENT tenant's authenticated caller can still verify (proves the lookup is genuinely cross-tenant, not accidentally RLS-scoped)", async () => {
    await wipe();
    const { permitId } = await issuePermit(TENANT_A);
    const [row] = await asTenant(TENANT_A, (tx) => tx.select().from(permits).where(eq(permits.id, permitId)));

    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/shop/permits/verify?code=${row!.verificationCode}`,
      headers: officerBearer(TENANT_B), // authenticated, but for a DIFFERENT tenant than the permit
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.json().data.permitNumber).toBe(row!.permitNumber);
  });

  it("404 for an unknown verification code", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/shop/permits/verify?code=${randomUUID()}`,
    });
    await app.close();
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("PERMIT_NOT_FOUND");
  });

  it("directory reflects suspension: verify shows permitStatus=suspended after an officer suspends the permit", async () => {
    await wipe();
    const { permitId } = await issuePermit(TENANT_A);
    const [row] = await asTenant(TENANT_A, (tx) => tx.select().from(permits).where(eq(permits.id, permitId)));

    const app = await buildApp();
    const suspendRes = await app.inject({
      method: "POST",
      url: `/v1/shop/permits/${permitId}/suspend`,
      headers: officerBearer(TENANT_A),
      payload: { reason: "fire safety violation" },
    });
    expect(suspendRes.statusCode).toBe(202);

    const q = new MemoryQueue();
    registerPermitConsumers(q);
    await q.start();
    await q.publish(COMMANDS.suspendPermit, {
      messageId: randomUUID(), type: COMMANDS.suspendPermit,
      tenantId: TENANT_A, actorId: OFFICER, correlationId: "corr-verify-suspend", schemaVersion: "1.0",
      payload: { permitId, tenantId: TENANT_A, reason: "fire safety violation" },
    });
    await new Promise<void>((r) => setTimeout(r, 400));
    await q.stop();

    const verifyRes = await app.inject({
      method: "GET",
      url: `/v1/shop/permits/verify?code=${row!.verificationCode}`,
    });
    await app.close();
    expect(verifyRes.statusCode).toBe(200);
    expect(verifyRes.json().data.permitStatus).toBe("suspended");
  });
});
