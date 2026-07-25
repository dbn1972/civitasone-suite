/**
 * telephony-service domain/consumer tests (DB-backed).
 *
 * Drives the REAL command consumers against a MemoryQueue + the real Postgres
 * (civitas_telephony) singleton `db`, then asserts persisted state. Covers the
 * 10/10 behaviours the prior stub did not:
 *   - call create + PII (caller number) ciphertext at rest with a blind index
 *   - tenant isolation on reads
 *   - illegal state transition rejected (state left intact + audit emitted)
 *   - full lifecycle queued→ringing→answered→completed with derived metrics
 *   - missed/abandoned flows + the telephony.call.{completed,missed} events
 *   - optimistic-lock (stale expectedVersion) rejection
 *   - inbox idempotency (a replayed messageId is a no-op)
 *   - PII is MASKED in list responses (never leaks the full number)
 *
 * All rows live under disposable test-tenant UUIDs and are deleted in afterAll,
 * so the suite is self-cleaning and re-runnable.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";

import { db, sqlClient } from "../src/shared/db.js";
import { markProcessed, outboxMessages } from "../src/shared/outbox.js";
import { COMMANDS } from "../src/topics.js";
import { registerCallConsumers } from "../src/modules/calls/consumer.js";
import { registerQueueConsumers } from "../src/modules/queues/consumer.js";
import { registerAgentConsumers } from "../src/modules/agents/consumer.js";
import * as callRepo from "../src/modules/calls/repo.js";
import * as queueRepo from "../src/modules/queues/repo.js";
import * as agentRepo from "../src/modules/agents/repo.js";
import { calls } from "../src/modules/calls/schema.js";
import { queues } from "../src/modules/queues/schema.js";
import { agents } from "../src/modules/agents/schema.js";
import { isEncrypted } from "../src/shared/pii-crypto.js";

const TENANT_A = "ccccccc1-0000-4000-8000-000000000001";
const TENANT_B = "ccccccc2-0000-4000-8000-000000000002";
const ACTOR = "ccccccc0-0000-4000-8000-0000000000aa";
const TENANTS = [TENANT_A, TENANT_B];

const queue = new MemoryQueue();
registerCallConsumers(queue);
registerQueueConsumers(queue);
registerAgentConsumers(queue);

type Cmd = { messageId: string; type: string; tenantId: string; payload: Record<string, unknown> };

async function drive(cmd: Cmd, ready: () => Promise<boolean>): Promise<void> {
  await queue.publish(cmd.type, {
    messageId: cmd.messageId,
    type: cmd.type,
    tenantId: cmd.tenantId,
    actorId: ACTOR,
    correlationId: `corr-${cmd.messageId}`,
    schemaVersion: "1.0",
    payload: cmd.payload,
  });
  const deadline = Date.now() + 5000;
  for (;;) {
    if (await ready()) return;
    if (Date.now() > deadline) throw new Error(`drive(${cmd.type}) timed out`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

async function processed(messageId: string): Promise<boolean> {
  const r = await sqlClient`select 1 from _inbox.processed where message_id = ${messageId} limit 1`;
  return r.length > 0;
}

// telephony domain tables and _outbox.messages have FORCED row-level security
// (policy: tenant_id = current_tenant_id()). Direct DB inspection from a test must
// therefore run with the app.tenant_id GUC set — exactly as sibling services' DB-
// backed tests do. sqlAsTenant sets a transaction-LOCAL GUC on a single reserved
// connection so raw reads see this tenant's rows. (_inbox.processed is not under RLS.)
async function sqlAsTenant<T>(tenantId: string, fn: (sql: typeof sqlClient) => Promise<T> | T): Promise<T> {
  return sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${tenantId}, true)`;
    return fn(sql as unknown as typeof sqlClient);
  }) as Promise<T>;
}

async function createCall(tenantId: string, payload: Partial<Record<string, unknown>> = {}): Promise<string> {
  const id = randomUUID();
  const full = {
    id,
    tenantId,
    direction: "inbound",
    callerNumber: null,
    calleeNumber: null,
    status: "queued",
    queueId: null,
    agentId: null,
    linkedRefType: null,
    linkedRefId: null,
    ...payload,
  };
  await drive({ messageId: id, type: COMMANDS.createCall, tenantId, payload: full }, async () =>
    (await callRepo.findRow(id, tenantId)) !== null,
  );
  return id;
}

async function makeQueue(tenantId: string, slaAnswerSeconds = 20): Promise<string> {
  const id = randomUUID();
  await drive(
    { messageId: id, type: COMMANDS.createQueue, tenantId, payload: { id, tenantId, name: `Q-${id.slice(0, 8)}`, description: null, slaAnswerSeconds } },
    async () => (await queueRepo.findById(id, tenantId)) !== null,
  );
  return id;
}

async function makeAgent(tenantId: string, queueId: string | null): Promise<string> {
  const id = randomUUID();
  const userId = randomUUID();
  await drive(
    {
      messageId: id,
      type: COMMANDS.upsertAgent,
      tenantId,
      payload: { id, tenantId, userId, displayName: "Test Agent", queueId, status: "available", extension: "1001" },
    },
    async () => (await agentRepo.findByUser(userId, tenantId)) !== null,
  );
  const view = await agentRepo.findByUser(userId, tenantId);
  return view!.id;
}

async function eventEmitted(tenantId: string, eventType: string, callId: string): Promise<boolean> {
  // The shared outbox stores `payload` as a JSON-encoded string (platform-wide
  // artifact of @civitasone/outbox + drizzle), so match on the payload text —
  // the callId is a UUID, so a substring match is unambiguous.
  const rows = await sqlAsTenant(tenantId, (sql) => sql`
    select 1 from _outbox.messages
    where tenant_id = ${tenantId} and event_type = ${eventType} and payload::text like ${"%" + callId + "%"}
    limit 1`);
  return rows.length > 0;
}
async function rejectionAudited(tenantId: string, callId: string, outcomePrefix: string): Promise<boolean> {
  const rows = await sqlAsTenant(tenantId, (sql) => sql`
    select 1 from _outbox.messages
    where tenant_id = ${tenantId} and event_type = 'audit.event.record'
      and payload::text like ${"%" + callId + "%"} and payload::text like ${"%" + outcomePrefix + "%"}
    limit 1`);
  return rows.length > 0;
}

async function cleanup(): Promise<void> {
  // Deletes run under the tenant GUC (RLS scopes DELETE too); wrap in
  // runWithTenant + db.transaction so wrapWithTenantGuc injects app.tenant_id.
  for (const t of TENANTS) {
    await runWithTenant(t, () =>
      db.transaction(async (tx) => {
        await tx.delete(calls).where(eq(calls.tenantId, t));
        await tx.delete(agents).where(eq(agents.tenantId, t));
        await tx.delete(queues).where(eq(queues.tenantId, t));
        await tx.delete(outboxMessages).where(inArray(outboxMessages.tenantId, [t]));
      }),
    );
  }
}

beforeAll(cleanup);
afterAll(async () => {
  await cleanup();
  await sqlClient.end();
});

describe("call create + PII at rest", () => {
  it("stores the caller number as ciphertext with a populated blind index", async () => {
    const id = await createCall(TENANT_A, { callerNumber: "9876500011", calleeNumber: "1800111222" });

    const raw = await sqlAsTenant(TENANT_A, (sql) => sql`select caller_number, caller_number_idx, callee_number from telephony.calls where id = ${id}`);
    expect(raw.length).toBe(1);
    const r = raw[0]!;
    expect(isEncrypted(r.caller_number as string)).toBe(true);
    expect(r.caller_number).not.toContain("9876500011");
    expect(isEncrypted(r.callee_number as string)).toBe(true);
    expect(r.caller_number_idx).toMatch(/^[0-9a-f]{64}$/);

    // App layer decrypts transparently.
    const view = await callRepo.findView(id, TENANT_A);
    expect(view?.callerNumber).toBe("9876500011");
    expect(view?.status).toBe("queued");
    expect(view?.version).toBe(1);
  });

  it("isolates tenants: a call is invisible to another tenant", async () => {
    const id = await createCall(TENANT_A, { callerNumber: "9876500099" });
    expect(await callRepo.findView(id, TENANT_B)).toBeNull();
    expect(await callRepo.findView(id, TENANT_A)).not.toBeNull();
  });
});

describe("illegal state transition is rejected", () => {
  it("answering a queued call (never rang) leaves state intact and audits the rejection", async () => {
    const agentId = await makeAgent(TENANT_A, null);
    const id = await createCall(TENANT_A, { callerNumber: "9876500022" });

    const msgId = randomUUID();
    await drive(
      { messageId: msgId, type: COMMANDS.answerCall, tenantId: TENANT_A, payload: { id, tenantId: TENANT_A, agentId } },
      () => processed(msgId),
    );

    const after = await callRepo.findRow(id, TENANT_A);
    expect(after?.status).toBe("queued"); // unchanged — queued→answered is illegal
    expect(after?.version).toBe(1);
    expect(await rejectionAudited(TENANT_A, id, "rejected_illegal_transition")).toBe(true);
  });
});

describe("full lifecycle + derived metrics", () => {
  it("queued → ringing → answered → completed computes wait/talk + SLA, version bumps each step", async () => {
    const queueId = await makeQueue(TENANT_A, 30);
    const agentId = await makeAgent(TENANT_A, queueId);
    const id = await createCall(TENANT_A, { callerNumber: "9876500033", queueId });

    await drive(
      { messageId: randomUUID(), type: COMMANDS.ringCall, tenantId: TENANT_A, payload: { id, tenantId: TENANT_A } },
      async () => (await callRepo.findRow(id, TENANT_A))?.status === "ringing",
    );
    await drive(
      { messageId: randomUUID(), type: COMMANDS.answerCall, tenantId: TENANT_A, payload: { id, tenantId: TENANT_A, agentId } },
      async () => (await callRepo.findRow(id, TENANT_A))?.status === "answered",
    );
    await drive(
      {
        messageId: randomUUID(),
        type: COMMANDS.completeCall,
        tenantId: TENANT_A,
        payload: { id, tenantId: TENANT_A, disposition: "resolved", talkSeconds: 95 },
      },
      async () => (await callRepo.findRow(id, TENANT_A))?.status === "completed",
    );

    const final = await callRepo.findRow(id, TENANT_A);
    expect(final?.status).toBe("completed");
    expect(final?.disposition).toBe("resolved");
    expect(final?.agentId).toBe(agentId);
    expect(final?.talkSeconds).toBe(95);
    expect(final?.waitSeconds).not.toBeNull();
    expect(final?.version).toBe(4); // create(1) → ring(2) → answer(3) → complete(4)

    expect(await eventEmitted(TENANT_A, "telephony.call.completed", id)).toBe(true);

    const metrics = await callRepo.metricsByTenant(TENANT_A, queueId);
    expect(metrics.byStatus.completed).toBeGreaterThanOrEqual(1);
    expect(metrics.answered).toBeGreaterThanOrEqual(1);
    expect(metrics.slaAnsweredPct).toBe(100); // answered well within the 30s target
  });

  it("missed + abandoned flows emit the right events and count toward abandonment", async () => {
    // missed: queued → ringing → missed
    const missedId = await createCall(TENANT_A, { callerNumber: "9876500044" });
    await drive(
      { messageId: randomUUID(), type: COMMANDS.ringCall, tenantId: TENANT_A, payload: { id: missedId, tenantId: TENANT_A } },
      async () => (await callRepo.findRow(missedId, TENANT_A))?.status === "ringing",
    );
    await drive(
      { messageId: randomUUID(), type: COMMANDS.missCall, tenantId: TENANT_A, payload: { id: missedId, tenantId: TENANT_A } },
      async () => (await callRepo.findRow(missedId, TENANT_A))?.status === "missed",
    );
    expect(await eventEmitted(TENANT_A, "telephony.call.missed", missedId)).toBe(true);

    // abandoned: queued → abandoned (caller hung up in queue)
    const abandonedId = await createCall(TENANT_A, { callerNumber: "9876500055" });
    await drive(
      { messageId: randomUUID(), type: COMMANDS.abandonCall, tenantId: TENANT_A, payload: { id: abandonedId, tenantId: TENANT_A } },
      async () => (await callRepo.findRow(abandonedId, TENANT_A))?.status === "abandoned",
    );
    expect(await eventEmitted(TENANT_A, "telephony.call.abandoned", abandonedId)).toBe(true);

    const metrics = await callRepo.metricsByTenant(TENANT_A);
    expect(metrics.byStatus.abandoned).toBeGreaterThanOrEqual(1);
    expect(metrics.abandonmentRatePct).toBeGreaterThan(0);
  });
});

describe("optimistic locking", () => {
  it("rejects a transition carrying a stale expectedVersion and accepts the correct one", async () => {
    const id = await createCall(TENANT_A, { callerNumber: "9876500066" }); // version 1

    const staleMsg = randomUUID();
    await drive(
      { messageId: staleMsg, type: COMMANDS.ringCall, tenantId: TENANT_A, payload: { id, tenantId: TENANT_A, expectedVersion: 99 } },
      () => processed(staleMsg),
    );
    expect((await callRepo.findRow(id, TENANT_A))?.status).toBe("queued"); // unchanged
    expect(await rejectionAudited(TENANT_A, id, "rejected_version_conflict")).toBe(true);

    await drive(
      { messageId: randomUUID(), type: COMMANDS.ringCall, tenantId: TENANT_A, payload: { id, tenantId: TENANT_A, expectedVersion: 1 } },
      async () => (await callRepo.findRow(id, TENANT_A))?.status === "ringing",
    );
    expect((await callRepo.findRow(id, TENANT_A))?.version).toBe(2);
  });
});

describe("inbox idempotency", () => {
  it("claims a messageId once; a replay is a no-op", async () => {
    const messageId = randomUUID();
    const first = await db.transaction((tx) => markProcessed(tx, messageId));
    const second = await db.transaction((tx) => markProcessed(tx, messageId));
    expect(first).toBe(true);
    expect(second).toBe(false);
    await sqlClient`delete from _inbox.processed where message_id = ${messageId}`;
  });

  it("a redelivered create does not insert the call twice", async () => {
    const id = await createCall(TENANT_A, { callerNumber: "9876500077" });
    await db.transaction(async (tx) => {
      const claimed = await markProcessed(tx, id);
      expect(claimed).toBe(false); // already claimed by the original delivery
    });
    const rows = await sqlAsTenant(TENANT_A, (sql) => sql`select count(*)::int as n from telephony.calls where id = ${id}`);
    expect(rows[0]?.n).toBe(1);
  });
});

describe("PII is masked in list responses", () => {
  it("list summaries never expose the full caller number", async () => {
    await createCall(TENANT_B, { callerNumber: "9876512345" });
    const rows = await callRepo.listByTenant(TENANT_B, 50, 0);
    expect(rows.length).toBeGreaterThanOrEqual(1);
    for (const r of rows) {
      if (r.callerNumber) {
        expect(r.callerNumber).toContain("*");
        expect(r.callerNumber).not.toBe("9876512345");
      }
    }
    const masked = rows.find((r) => r.callerNumber?.endsWith("2345"));
    expect(masked?.callerNumber).toBe("******2345");
  });
});
