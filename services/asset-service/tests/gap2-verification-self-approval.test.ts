/**
 * GAP2-ASSETS-VERIFICATION-01 (MEDIUM)
 *
 * Physical-verification approval must enforce segregation of duties: the same
 * user who created/submitted a session may NOT approve it. On the old code the
 * submitter's own approval returned 202 and the session became "approved".
 *
 * These assert the NEW behaviour and FAIL on the old code.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { MemoryQueue } from "@civitasone/queue";
import { eq } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { db, sqlClient } from "../src/shared/db.js";
import { physicalVerifications } from "../src/modules/verification/schema.js";
import { outboxMessages, processed } from "../src/shared/outbox.js";
import { registerVerificationConsumers } from "../src/modules/verification/consumer.js";
import { COMMANDS } from "../src/topics.js";
import * as repo from "../src/modules/verification/repo.js";
import { drainOrFail } from "../../../vitest.drain";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";

// Unique hex-only "…00000d0a<n>" suffix for this file.
const TENANT   = "11111111-aaaa-4000-8000-00000d0a0001";
const CREATOR  = "22222222-bbbb-4000-8000-00000d0a0001";
const APPROVER = "33333333-cccc-4000-8000-00000d0a0001";
const SESSION  = "44444444-dddd-4000-8000-00000d0a0001";

function token(tenantId: string, actorId: string) {
  return signToken({ sub: actorId, tid: tenantId, roles: ["asset_manager", "asset_admin", "super_admin"], sid: "s-vsod" }, SECRET, 3600);
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
function asTenant<T>(tenantId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return runWithTenant(tenantId, () => db.transaction(fn)) as Promise<T>;
}

let app: FastifyInstance;

beforeAll(async () => {
  const { buildApp } = await import("../src/app.js");
  app = await buildApp();
  await app.ready();

  // Seed a SUBMITTED verification session created by CREATOR via the consumer.
  const q = new MemoryQueue();
  registerVerificationConsumers(q);
  await q.start();
  await q.publish(COMMANDS.verificationCreate, {
    messageId: randomUUID(), type: COMMANDS.verificationCreate,
    tenantId: TENANT, actorId: CREATOR, correlationId: "corr-vc", schemaVersion: "1.0",
    payload: { id: SESSION, tenantId: TENANT, verificationDate: "2026-06-01", notes: null, location: null },
  });
  await drainOrFail(q);
  await q.publish(COMMANDS.verificationSubmit, {
    messageId: randomUUID(), type: COMMANDS.verificationSubmit,
    tenantId: TENANT, actorId: CREATOR, correlationId: "corr-vs", schemaVersion: "1.0",
    payload: { id: SESSION, tenantId: TENANT },
  });
  await drainOrFail(q);
  await q.stop();
});

afterAll(async () => {
  await asTenant(TENANT, async (tx) => {
    await tx.delete(physicalVerifications).where(eq(physicalVerifications.tenantId, TENANT));
    await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
    await tx.delete(processed).where(eq(processed.messageId, SESSION));
  });
  await app.close();
  await sqlClient.end();
});

describe("GAP2-ASSETS-VERIFICATION-01 — self-approval forbidden", () => {
  it("confirms the seeded session is submitted and created by CREATOR", async () => {
    const s = await runWithTenant(TENANT, () => repo.findVerificationById(SESSION, TENANT));
    expect(s?.status).toBe("submitted");
    expect(s?.createdBy).toBe(CREATOR);
  });

  it("the CREATOR cannot approve their own session → 403 SELF_APPROVAL_FORBIDDEN", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/assets/verifications/${SESSION}/approve`,
      headers: { authorization: `Bearer ${token(TENANT, CREATOR)}`, "content-type": "application/json" },
      payload: {},
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("SELF_APPROVAL_FORBIDDEN");

    const s = await runWithTenant(TENANT, () => repo.findVerificationById(SESSION, TENANT));
    expect(s?.status).toBe("submitted"); // unchanged
  });

  it("a DIFFERENT approver is accepted (202) and the consumer approves it", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/assets/verifications/${SESSION}/approve`,
      headers: { authorization: `Bearer ${token(TENANT, APPROVER)}`, "content-type": "application/json" },
      payload: {},
    });
    expect(res.statusCode).toBe(202);

    const q = new MemoryQueue();
    registerVerificationConsumers(q);
    await q.start();
    await q.publish(COMMANDS.verificationApprove, {
      messageId: randomUUID(), type: COMMANDS.verificationApprove,
      tenantId: TENANT, actorId: APPROVER, correlationId: "corr-va", schemaVersion: "1.0",
      payload: { id: SESSION, tenantId: TENANT },
    });
    await drainOrFail(q);
    await q.stop();

    const s = await runWithTenant(TENANT, () => repo.findVerificationById(SESSION, TENANT));
    expect(s?.status).toBe("approved");
    expect(s?.approvedBy).toBe(APPROVER);
  });

  it("consumer re-asserts SoD: an approve command whose actor == creator changes nothing", async () => {
    // Re-seed a fresh submitted session, then try to approve it as the creator
    // via the consumer directly — the write must be refused.
    const sid = randomUUID();
    const q = new MemoryQueue();
    registerVerificationConsumers(q);
    await q.start();
    await q.publish(COMMANDS.verificationCreate, {
      messageId: randomUUID(), type: COMMANDS.verificationCreate,
      tenantId: TENANT, actorId: CREATOR, correlationId: "corr-vc2", schemaVersion: "1.0",
      payload: { id: sid, tenantId: TENANT, verificationDate: "2026-06-02", notes: null, location: null },
    });
    await drainOrFail(q);
    await q.publish(COMMANDS.verificationSubmit, {
      messageId: randomUUID(), type: COMMANDS.verificationSubmit,
      tenantId: TENANT, actorId: CREATOR, correlationId: "corr-vs2", schemaVersion: "1.0",
      payload: { id: sid, tenantId: TENANT },
    });
    await drainOrFail(q);
    await q.publish(COMMANDS.verificationApprove, {
      messageId: randomUUID(), type: COMMANDS.verificationApprove,
      tenantId: TENANT, actorId: CREATOR, correlationId: "corr-va2", schemaVersion: "1.0",
      payload: { id: sid, tenantId: TENANT },
    });
    await drainOrFail(q);
    await q.stop();

    const s = await runWithTenant(TENANT, () => repo.findVerificationById(sid, TENANT));
    expect(s?.status).toBe("submitted"); // self-approval refused in the consumer
    await asTenant(TENANT, (tx) => tx.delete(physicalVerifications).where(eq(physicalVerifications.id, sid)));
  });
});
