/**
 * GAP-ESTAB-DFA-02 — the approver's remarks are kept, and the maker-checker rule holds at the consumer.
 *
 * The web Approve dialog collects "Approval remarks" (requireReason) and posts { reason }. The route's
 * body schema had no `reason` field, so zod stripped it: the remarks were never published, never
 * audited. Now they travel with the command and are written into the dfa.approved audit event.
 * Sign is likewise refused for the drafter inside the consumer (defence in depth: the route already
 * 403s), not just at the route.
 *
 * Real Postgres; the consumers run on a MemoryQueue wired like production (tenant GUC per message).
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { MemoryQueue, type Queue, type Handler } from "@civitasone/queue";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { queue as sharedQueue } from "../src/shared/infra.js";
import { estabDfa, estabDfaVersion } from "../src/modules/dfa/schema.js";
import { insertDfa, findDfaById } from "../src/modules/dfa/repo.js";
import { formatDfaNo } from "../src/modules/dfa/domain.js";
import { approveDfaBody } from "../src/modules/dfa/validators.js";
import { registerDfaConsumers } from "../src/modules/dfa/consumer.js";
import { outboxMessages, processed } from "../src/shared/outbox.js";
import { COMMANDS } from "../src/topics.js";

const SECRET = process.env.JWT_SECRET as string;
const TENANT = "61111111-aaaa-4000-8000-0000000c0211";
const DRAFTER = "00000000-eeee-4000-8000-0000000c0211";
const APPROVER = "00000000-eeee-4000-8000-0000000c0212";

const auth = (actor: string, roles: string[]) => ({
  authorization: `Bearer ${signToken({ sub: actor, tid: TENANT, roles, sid: "sess-dfa02-remarks" }, SECRET, 3600)}`,
  "x-tenant-id": TENANT,
});

function wireTenantAwareQueue<Q extends Queue>(q: Q): Q {
  const rawSubscribe = q.subscribe.bind(q);
  q.subscribe = ((topic: string, handler: Handler) =>
    rawSubscribe(topic, withTenantConsumer(handler) as Handler)) as typeof q.subscribe;
  return q;
}

const env = (type: string, payload: Record<string, unknown>, actor: string) => {
  const messageId = randomUUID();
  return { messageId, type, tenantId: TENANT, actorId: actor, correlationId: `c-${messageId.slice(0, 8)}`, schemaVersion: "1.0", payload };
};

async function waitFor(fn: () => Promise<boolean>, ms = 4000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) { if (await fn()) return; await new Promise((r) => setTimeout(r, 40)); }
}
const isProcessed = (messageId: string) => async () =>
  (await runWithTenant(TENANT, () => db.transaction((tx) => tx.select().from(processed).where(eq(processed.messageId, messageId))))).length === 1;

async function clean() {
  await runWithTenant(TENANT, () =>
    db.transaction(async (tx) => {
      await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
      await tx.delete(estabDfaVersion).where(eq(estabDfaVersion.tenantId, TENANT));
      await tx.delete(estabDfa).where(eq(estabDfa.tenantId, TENANT));
    }),
  );
}

let dfaSeq = 0;
async function seed(status: string): Promise<string> {
  const id = randomUUID();
  await runWithTenant(TENANT, () =>
    db.transaction((tx) =>
      insertDfa(tx, {
        id, tenantId: TENANT, dfaNo: formatDfaNo("order", 2026, ++dfaSeq),
        fileId: null, communicationType: "order", templateCode: null,
        subject: "Sanction of advance", body: "Body", recipientEmployeeId: null,
        recipientName: null, recipientAddress: null,
        status, createdBy: DRAFTER, updatedBy: DRAFTER,
      }),
    ),
  );
  return id;
}

const dfaRow = (id: string) => runWithTenant(TENANT, () => findDfaById(id, TENANT));
const auditFor = async (action: string, id: string) => (await runWithTenant(TENANT, () =>
  db.transaction((tx) => tx.select().from(outboxMessages).where(eq(outboxMessages.tenantId, TENANT)))))
  .map((r) => r.payload as { action?: string; resourceId?: string; metadata?: Record<string, unknown> })
  .filter((p) => p.action === action && p.resourceId === id);

let app: FastifyInstance;
beforeAll(async () => { app = await buildApp(); });
beforeEach(clean);
afterEach(() => { vi.restoreAllMocks(); });
afterAll(async () => { await clean(); await app.close(); await sqlClient.end(); });

describe("approveDfaBody — the approver's remarks", () => {
  it("accepts remarks, trims them, and stays optional", () => {
    expect(approveDfaBody.parse({ reason: "  Within delegated powers.  " }).reason).toBe("Within delegated powers.");
    expect(approveDfaBody.parse({}).reason).toBeUndefined();
  });
  it("rejects blank or over-long remarks", () => {
    expect(approveDfaBody.safeParse({ reason: "   " }).success).toBe(false);
    expect(approveDfaBody.safeParse({ reason: "x".repeat(1001) }).success).toBe(false);
    expect(approveDfaBody.safeParse({ reason: "x".repeat(1000) }).success).toBe(true);
  });
});

describe("POST /v1/estab/dfa/:id/approve carries the remarks into the command", () => {
  it("publishes the reason with the approve command", async () => {
    const id = await seed("pending_approval");
    const publish = vi.spyOn(sharedQueue, "publish");
    const res = await app.inject({
      method: "POST", url: `/v1/estab/dfa/${id}/approve`,
      headers: auth(APPROVER, ["estab_admin"]), payload: { reason: "Checked against the sanction order." },
    });
    expect(res.statusCode).toBe(202);
    const call = publish.mock.calls.find((c) => c[0] === COMMANDS.dfaApprove);
    expect((call?.[1] as { payload: { reason?: string } }).payload.reason).toBe("Checked against the sanction order.");
  });

  it("still accepts an approval with no remarks (older clients) and publishes no reason key", async () => {
    const id = await seed("pending_approval");
    const publish = vi.spyOn(sharedQueue, "publish");
    const res = await app.inject({ method: "POST", url: `/v1/estab/dfa/${id}/approve`, headers: auth(APPROVER, ["estab_admin"]), payload: {} });
    expect(res.statusCode).toBe(202);
    const call = publish.mock.calls.find((c) => c[0] === COMMANDS.dfaApprove);
    expect(Object.keys((call?.[1] as { payload: object }).payload)).not.toContain("reason");
  });
});

describe("dfaApprove consumer — remarks are audited, maker-checker holds", () => {
  it("writes the approver's remarks into the dfa.approved audit event, with actor and modality", async () => {
    const id = await seed("pending_approval");
    const q = wireTenantAwareQueue(new MemoryQueue({ maxAttempts: 1 }));
    registerDfaConsumers(q);
    await q.start();
    const m = env(COMMANDS.dfaApprove, { id, tenantId: TENANT, approvedBy: APPROVER, modality: "approved", reason: "  Approved: within the delegated limit.  " }, APPROVER);
    await q.publish(COMMANDS.dfaApprove, m);
    await waitFor(isProcessed(m.messageId));
    await q.stop();
    expect((await dfaRow(id))?.status).toBe("approved");
    const events = await auditFor("dfa.approved", id);
    expect(events).toHaveLength(1);
    expect(events[0]?.metadata).toMatchObject({ modality: "approved", hasConditions: false, reason: "Approved: within the delegated limit." });
    const actors = (await runWithTenant(TENANT, () => db.transaction((tx) => tx.select().from(outboxMessages).where(eq(outboxMessages.tenantId, TENANT)))))
      .filter((r) => (r.payload as { action?: string }).action === "dfa.approved").map((r) => r.actorId);
    expect(actors).toEqual([APPROVER]);
  });

  it("an approval without remarks audits no reason key", async () => {
    const id = await seed("pending_approval");
    const q = wireTenantAwareQueue(new MemoryQueue({ maxAttempts: 1 }));
    registerDfaConsumers(q);
    await q.start();
    const m = env(COMMANDS.dfaApprove, { id, tenantId: TENANT, modality: "approved" }, APPROVER);
    await q.publish(COMMANDS.dfaApprove, m);
    await waitFor(isProcessed(m.messageId));
    await q.stop();
    const events = await auditFor("dfa.approved", id);
    expect(events).toHaveLength(1);
    expect(Object.keys(events[0]?.metadata ?? {})).not.toContain("reason");
  });

  it("the drafter cannot approve: the command dead-letters, nothing changes, nothing is audited", async () => {
    const id = await seed("pending_approval");
    const q = wireTenantAwareQueue(new MemoryQueue({ maxAttempts: 1 }));
    registerDfaConsumers(q);
    await q.start();
    await q.publish(COMMANDS.dfaApprove, env(COMMANDS.dfaApprove, { id, tenantId: TENANT, reason: "Self approval." }, DRAFTER));
    await waitFor(async () => q.dlq.length === 1);
    await q.stop();
    expect(q.dlq[0]?.error).toMatch(/MAKER_CHECKER/);
    expect((await dfaRow(id))?.status).toBe("pending_approval");
    expect(await auditFor("dfa.approved", id)).toHaveLength(0);
  });
});

describe("dfaSign consumer — the drafter cannot sign their own DFA (defence in depth)", () => {
  it("dead-letters a sign command from the drafter and leaves the DFA approved", async () => {
    const id = await seed("approved");
    const q = wireTenantAwareQueue(new MemoryQueue({ maxAttempts: 1 }));
    registerDfaConsumers(q);
    await q.start();
    await q.publish(COMMANDS.dfaSign, env(COMMANDS.dfaSign, { id, tenantId: TENANT, signedBy: DRAFTER }, DRAFTER));
    await waitFor(async () => q.dlq.length === 1);
    await q.stop();
    expect(q.dlq[0]?.error).toMatch(/MAKER_CHECKER/);
    const row = await dfaRow(id);
    expect(row?.status).toBe("approved");
    expect(row?.signedBy).toBeNull();
  });

  it("a different officer signs it", async () => {
    const id = await seed("approved");
    const q = wireTenantAwareQueue(new MemoryQueue({ maxAttempts: 1 }));
    registerDfaConsumers(q);
    await q.start();
    const m = env(COMMANDS.dfaSign, { id, tenantId: TENANT, signedBy: APPROVER }, APPROVER);
    await q.publish(COMMANDS.dfaSign, m);
    await waitFor(isProcessed(m.messageId));
    await q.stop();
    const row = await dfaRow(id);
    expect(row?.status).toBe("signed");
    expect(row?.signedBy).toBe(APPROVER);
    expect(await auditFor("dfa.signed", id)).toHaveLength(1);
  });
});
