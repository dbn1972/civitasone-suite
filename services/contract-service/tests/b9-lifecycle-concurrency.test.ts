/**
 * B9-contract (UAT bundle 9) — contract lifecycle concurrency.
 *
 * F74 made amend safe (row lock + NonRetryable business rules + 409 at the
 * route). The other state-changing handlers (approve, activate, close,
 * terminate, submit-approval, milestone complete / mark-late, bond transition)
 * still read the status, validated it, and then updated with no row lock and
 * no status predicate. Two concurrent / duplicate commands both read the old
 * status, both passed validation and both applied:
 *   - terminate racing activate: the contract was terminated, then re-activated;
 *   - close + terminate on one active contract: both applied, both events emitted;
 *   - a duplicate approve: applied twice (two approved events, lost version bump);
 *   - a duplicate milestone complete: two milestone.completed (payable) events;
 *   - release + claim on one bond: both applied.
 *
 * Each race is made deterministic against a real Postgres: a blocker
 * transaction holds the row lock, both commands are started (in a fixed order)
 * and parked on that lock, then the blocker commits. Without the fix both
 * commands had already passed the status check and both apply; with the fix
 * they queue on SELECT ... FOR UPDATE and the second sees the first's result.
 *
 * The route half: an illegal transition is answered 409 synchronously (like
 * F74's amend) instead of 202.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { isNonRetryable } from "@civitasone/queue";
import type { Queue, Handler } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import type { FastifyInstance } from "fastify";
import { and, eq, sql } from "drizzle-orm";
import { buildApp } from "../src/app.js";
import { db } from "../src/shared/db.js";
import { outboxMessages } from "../src/shared/outbox.js";
import { contractContracts, contractMilestones, contractPerformanceBonds } from "../src/modules/contracts/schema.js";
import { registerContractConsumers } from "../src/modules/contracts/consumer.js";
import { COMMANDS, EVENTS } from "../src/topics.js";

const MAKER   = "00000000-b9c0-4000-8000-0000000000a1";
const CHECKER = "00000000-b9c0-4000-8000-0000000000a2";
const TENANT  = "11111111-b9c0-4000-8000-0000000000b9";
// JWT secret comes from vitest.config.ts env (no literal here).
const SECRET  = process.env.JWT_SECRET ?? "";

const inTenant = <T>(fn: (tx: typeof db) => Promise<T>) =>
  runWithTenant(TENANT, () => db.transaction(async (tx) => fn(tx as unknown as typeof db)));

async function seed(status: string): Promise<string> {
  const id = randomUUID();
  await inTenant((tx) => tx.insert(contractContracts).values({
    id, tenantId: TENANT, contractNo: `B9C-${id.slice(0, 8)}`, vendorId: randomUUID(),
    title: "B9 lifecycle race", valueMinor: 1_000_000n, currency: "INR",
    startDate: "2026-07-01", expiry: "2027-06-30", status, version: 1,
    createdBy: MAKER, updatedBy: MAKER,
  }));
  return id;
}

async function seedMilestone(contractId: string): Promise<string> {
  const id = randomUUID();
  await inTenant((tx) => tx.insert(contractMilestones).values({
    id, contractId, tenantId: TENANT, title: "Phase 1", dueDate: "2026-09-01",
    amountMinor: 500_000n, currency: "INR", status: "pending", createdBy: MAKER, updatedBy: MAKER,
  }));
  return id;
}

async function seedBond(contractId: string): Promise<string> {
  const id = randomUUID();
  await inTenant((tx) => tx.insert(contractPerformanceBonds).values({
    id, contractId, tenantId: TENANT, bondType: "performance", amountMinor: 100_000n, currency: "INR",
    issuer: "State Bank", referenceNo: `BG-${id.slice(0, 8)}`, validFrom: "2026-07-01", validTo: "2027-07-01",
    status: "held", createdBy: MAKER, updatedBy: MAKER,
  }));
  return id;
}

async function contract(id: string) {
  const [row] = await inTenant((tx) => tx.select().from(contractContracts).where(eq(contractContracts.id, id)));
  return row;
}

/** Outbox events of `topic` whose payload references `key` = `value`. */
async function events(topic: string, key: string, value: string): Promise<number> {
  const rows = await inTenant((tx) => tx.select().from(outboxMessages)
    .where(and(eq(outboxMessages.tenantId, TENANT), eq(outboxMessages.topic, topic))));
  return rows.filter((r) => (r.payload as Record<string, unknown> | null)?.[key] === value).length;
}

async function wipe() {
  await inTenant(async (tx) => {
    await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
    await tx.delete(contractMilestones).where(eq(contractMilestones.tenantId, TENANT));
    await tx.delete(contractPerformanceBonds).where(eq(contractPerformanceBonds.tenantId, TENANT));
    await tx.delete(contractContracts).where(eq(contractContracts.tenantId, TENANT));
  });
}

function envelope(type: string, actorId: string, payload: Record<string, unknown>) {
  const messageId = randomUUID();
  return {
    messageId, type, tenantId: TENANT, actorId, correlationId: `b9c-${messageId.slice(0, 8)}`,
    schemaVersion: "1.0", timestamp: new Date().toISOString(), payload,
  };
}

// ── race harness ─────────────────────────────────────────────────────────────
type Outcome = { ok: true } | { ok: false; err: unknown };

/**
 * Hold a FOR UPDATE lock on one row in its own transaction until released.
 * Returns the blocker's backend pid (to find exactly the commands parked on it,
 * even while other test files run against the same database) and a release.
 */
async function holdLock(lock: (tx: typeof db) => Promise<unknown>): Promise<{ pid: number; release: () => Promise<void> }> {
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  let locked!: (pid: number) => void;
  const ready = new Promise<number>((r) => { locked = r; });
  const done = inTenant(async (tx) => {
    await lock(tx);
    const rows = await tx.execute(sql`select pg_backend_pid()::int as pid`);
    locked(Number((rows as unknown as Array<{ pid: number }>)[0]?.pid));
    await gate;
  });
  const pid = await ready;
  return { pid, release: async () => { release(); await done; } };
}

/** Wait until `n` backends are (transitively) blocked behind the blocker `pid`. */
async function waitForLockWaiters(blocker: number, n: number): Promise<void> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const rows = await inTenant((tx) => tx.execute(sql`
      select pid::int as pid, pg_blocking_pids(pid) as blockers from pg_stat_activity
      where datname = current_database() and wait_event_type = 'Lock'`));
    const waiting = rows as unknown as Array<{ pid: number; blockers: number[] }>;
    const behind = new Set<number>([blocker]);
    for (let grew = true; grew;) {
      grew = false;
      for (const w of waiting) {
        if (!behind.has(w.pid) && w.blockers.some((b) => behind.has(Number(b)))) { behind.add(w.pid); grew = true; }
      }
    }
    const count = behind.size - 1;
    if (count >= n) return;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${n} lock waiters (have ${count})`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

const handlers = new Map<string, Handler>();
beforeAll(async () => {
  await wipe();
  const capture = { subscribe: (topic: string, h: Handler) => { handlers.set(topic, h); } } as unknown as Queue;
  registerContractConsumers(capture);
});
afterAll(async () => { await wipe(); });

function run(topic: string, actor: string, payload: Record<string, unknown>): Promise<Outcome> {
  const h = handlers.get(topic);
  if (!h) throw new Error(`no handler for ${topic}`);
  return h(envelope(topic, actor, payload) as never).then(
    (): Outcome => ({ ok: true }),
    (err: unknown): Outcome => ({ ok: false, err }),
  );
}

/**
 * Park `first` then `second` on the row lock held by `lock`, release it, and
 * return both outcomes (first, second).
 */
async function race(
  lock: (tx: typeof db) => Promise<unknown>,
  first: () => Promise<Outcome>,
  second: () => Promise<Outcome>,
): Promise<[Outcome, Outcome]> {
  const { pid, release } = await holdLock(lock);
  const a = first();
  await waitForLockWaiters(pid, 1);
  const b = second();
  await waitForLockWaiters(pid, 2);
  await release();
  return [await a, await b];
}

const lockContract = (id: string) => (tx: typeof db) =>
  tx.select().from(contractContracts).where(eq(contractContracts.id, id)).for("update");

function expectRejected(o: Outcome, code: string): void {
  expect(o.ok).toBe(false);
  if (o.ok) return;
  expect(isNonRetryable(o.err)).toBe(true);
  expect(String((o.err as Error).message)).toContain(code);
}

// ── 1. Consumer: concurrent / duplicate lifecycle transitions ────────────────
describe("B9-contract consumer: lifecycle transitions serialise on the contract row", () => {
  it("terminate racing activate on an approved contract: the activate cannot resurrect it", async () => {
    const id = await seed("approved");
    const [term, act] = await race(
      lockContract(id),
      () => run(COMMANDS.contractTerminate, CHECKER, { id, tenantId: TENANT, reason: "vendor default" }),
      () => run(COMMANDS.contractActivate, CHECKER, { id, tenantId: TENANT }),
    );
    expect(term.ok).toBe(true);
    expectRejected(act, "INVALID_TRANSITION");
    const row = await contract(id);
    expect(row?.status).toBe("terminated");
    expect(row?.version).toBe(2);
    expect(await events(EVENTS.contractActivated, "contractId", id)).toBe(0);
    expect(await events(EVENTS.contractTerminated, "contractId", id)).toBe(1);
  });

  it("close + terminate on the same active contract: exactly one applies", async () => {
    const id = await seed("active");
    const [close, term] = await race(
      lockContract(id),
      () => run(COMMANDS.contractClose, CHECKER, { id, tenantId: TENANT }),
      () => run(COMMANDS.contractTerminate, CHECKER, { id, tenantId: TENANT, reason: "breach of terms" }),
    );
    expect(close.ok).toBe(true);
    expectRejected(term, "INVALID_TRANSITION");
    const row = await contract(id);
    expect(row?.status).toBe("closed");
    expect(row?.version).toBe(2);
    expect(await events(EVENTS.contractClosed, "contractId", id)).toBe(1);
    expect(await events(EVENTS.contractTerminated, "contractId", id)).toBe(0);
  });

  it("a duplicate approve (two deliveries, distinct message ids) applies once", async () => {
    const id = await seed("draft");
    const [a, b] = await race(
      lockContract(id),
      () => run(COMMANDS.contractApprove, CHECKER, { id, tenantId: TENANT }),
      () => run(COMMANDS.contractApprove, CHECKER, { id, tenantId: TENANT }),
    );
    expect(a.ok).toBe(true);
    expectRejected(b, "INVALID_TRANSITION");
    const row = await contract(id);
    expect(row?.status).toBe("approved");
    expect(row?.version).toBe(2);
    expect(await events(EVENTS.contractApproved, "contractId", id)).toBe(1);
  });

  it("submit-approval racing approve on a draft: the submit cannot move an approved contract back", async () => {
    const id = await seed("draft");
    const [appr, submit] = await race(
      lockContract(id),
      () => run(COMMANDS.contractApprove, CHECKER, { id, tenantId: TENANT }),
      () => run(COMMANDS.contractSubmitApproval, MAKER, { id, tenantId: TENANT }),
    );
    expect(appr.ok).toBe(true);
    expectRejected(submit, "INVALID_TRANSITION");
    expect((await contract(id))?.status).toBe("approved");
  });
});

// ── 2. Consumer: milestone and bond child rows ───────────────────────────────
describe("B9-contract consumer: milestone / bond transitions serialise on their row", () => {
  it("a duplicate milestone complete emits one payable milestone.completed event", async () => {
    const cid = await seed("active");
    const mid = await seedMilestone(cid);
    const payload = { contractId: cid, milestoneId: mid, tenantId: TENANT, achievedDate: "2026-08-15" };
    const [a, b] = await race(
      (tx) => tx.select().from(contractMilestones).where(eq(contractMilestones.id, mid)).for("update"),
      () => run(COMMANDS.milestoneComplete, CHECKER, payload),
      () => run(COMMANDS.milestoneMarkLate, CHECKER, { ...payload, achievedDate: "2026-10-01" }),
    );
    // The second is an idempotent no-op (already completed), as before.
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    const [m] = await inTenant((tx) => tx.select().from(contractMilestones).where(eq(contractMilestones.id, mid)));
    expect(m?.status).toBe("completed");
    expect(m?.penaltyMinor).toBe(0n);
    expect(m?.version).toBe(2);
    expect(await events(EVENTS.milestoneCompleted, "milestoneId", mid)).toBe(1);
  });

  it("release + claim on the same held bond: exactly one applies", async () => {
    const cid = await seed("active");
    const bid = await seedBond(cid);
    const [rel, claim] = await race(
      (tx) => tx.select().from(contractPerformanceBonds).where(eq(contractPerformanceBonds.id, bid)).for("update"),
      () => run(COMMANDS.bondTransition, CHECKER, { contractId: cid, bondId: bid, tenantId: TENANT, toStatus: "released" }),
      () => run(COMMANDS.bondTransition, CHECKER, { contractId: cid, bondId: bid, tenantId: TENANT, toStatus: "claimed" }),
    );
    expect(rel.ok).toBe(true);
    expectRejected(claim, "INVALID_BOND_TRANSITION");
    const [b] = await inTenant((tx) => tx.select().from(contractPerformanceBonds).where(eq(contractPerformanceBonds.id, bid)));
    expect(b?.status).toBe("released");
    expect(b?.version).toBe(2);
    expect(await events(EVENTS.bondTransitioned, "bondId", bid)).toBe(1);
  });
});

// ── 3. Route: illegal transitions are 409 synchronously (F74 pattern) ────────
describe("B9-contract route: illegal lifecycle transitions -> 409 INVALID_TRANSITION", () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await buildApp(); });
  afterAll(async () => { await app.close(); });

  function auth(sub: string) {
    return { authorization: `Bearer ${signToken({ sub, tid: TENANT, roles: ["procurement_admin"] }, SECRET, 3600)}` };
  }

  const cases: Array<[string, string, string, string, Record<string, unknown>]> = [
    ["approve on closed",          "closed",   "approve",         CHECKER, {}],
    ["activate on draft",          "draft",    "activate",        CHECKER, {}],
    ["close on approved",          "approved", "close",           CHECKER, {}],
    ["terminate on terminated",    "terminated", "terminate",     CHECKER, { reason: "duplicate termination" }],
    ["submit-approval on active",  "active",   "submit-approval", MAKER,   {}],
  ];
  for (const [name, status, action, actor, payload] of cases) {
    it(`${name} -> 409`, async () => {
      const id = await seed(status);
      const res = await app.inject({
        method: "POST", url: `/v1/contract/contracts/${id}/${action}`, headers: auth(actor), payload,
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe("INVALID_TRANSITION");
      expect((await contract(id))?.status).toBe(status);
    });
  }

  it("a legal transition is still accepted (activate on approved -> 202)", async () => {
    const id = await seed("approved");
    const res = await app.inject({
      method: "POST", url: `/v1/contract/contracts/${id}/activate`, headers: auth(CHECKER), payload: {},
    });
    expect(res.statusCode).toBe(202);
  });
});
