/**
 * GAP-FINANCE-JOURNAL-ENTRY-06 -- a hand-typed voucher number is unique per
 * tenant, and a duplicate is a synchronous 409 DUPLICATE_VOUCHER (with a
 * field-level error), not a 202 that later fails silently in the consumer.
 *
 *  - POST /v1/finance/journals with a typed voucherNo that already exists
 *    (as a posted journal OR a still-pending draft) -> 409, no second journal.
 *  - An omitted / blank / "AUTO" voucher is never a duplicate (server-allocated).
 *  - A replay of the same request (same idempotency key => same journal id) is
 *    not a duplicate of itself.
 *  - The same number in ANOTHER tenant is fine.
 *  - The unique index stays the authority for a true race: the consumer records
 *    the loser as a failure audit event, does not retry and does not throw.
 *
 * Real Postgres (no mocks), same shape as dom-024 / journal-budget-override-routes.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { MemoryQueue, type Handler } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { eq, and } from "drizzle-orm";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { scoped } from "./_tenant.js";
import { financeJournals } from "../src/modules/gl/schema.js";
import { outboxMessages, processed } from "../src/shared/outbox.js";
import { registerGlConsumers } from "../src/modules/gl/consumer.js";
import { isAutoVoucherNo } from "../src/modules/gl/domain.js";
import { isVoucherNoViolation } from "../src/modules/gl/repo.js";
import { COMMANDS } from "../src/topics.js";

// Set by the service vitest config (never a literal in a test file: CI scans every commit for secrets).
const SECRET = process.env.JWT_SECRET as string;
// GL is append-only (finance_svc has no DELETE grant on gl.finance_journals), so
// a fresh random tenant per run keeps the row counts below exact on a re-run.
const TENANT = randomUUID();
const OTHER_TENANT = randomUUID();
const MAKER = randomUUID();
const VOUCHER = "JV-2026-001";
const EXPENSE = randomUUID();
const BANK = randomUUID();

const headers = (tenant: string, idempotencyKey: string) => ({
  authorization: `Bearer ${signToken({ sub: MAKER, tid: tenant, roles: ["finance_officer"], sid: "sess-je06" }, SECRET)}`,
  "content-type": "application/json",
  "x-idempotency-key": idempotencyKey,
});

const payload = (voucherNo?: string) => ({
  ...(voucherNo === undefined ? {} : { voucherNo }),
  type: "journal",
  postingDate: "2026-08-15",
  lines: [
    { accountCode: EXPENSE, debitMinor: "150050", creditMinor: "0" },
    { accountCode: BANK, debitMinor: "0", creditMinor: "150050" },
  ],
});

const drain = () => (queue as MemoryQueue).drain();
const journalsWithVoucher = (tenant: string, voucherNo: string) =>
  scoped(tenant, (tx) => tx.select().from(financeJournals).where(and(eq(financeJournals.tenantId, tenant), eq(financeJournals.voucherNo, voucherNo))));

function tenantWrappedQueue(): MemoryQueue {
  const q = new MemoryQueue({ maxAttempts: 1 });
  const rawSubscribe = q.subscribe.bind(q);
  q.subscribe = ((topic: string, handler: Handler) =>
    rawSubscribe(topic, (msg: Parameters<Handler>[0]) => runWithTenant(msg.tenantId, () => handler(msg)))) as typeof q.subscribe;
  return q;
}

beforeAll(() => { registerGlConsumers(queue); });
// Leave no outbox rows behind: other suites run a real relay over the shared outbox table.
afterAll(async () => {
  for (const t of [TENANT, OTHER_TENANT]) {
    await scoped(t, (tx) => tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, t))).catch(() => {});
  }
  await sqlClient.end();
});

describe("isAutoVoucherNo (pure)", () => {
  it("treats omitted, blank and AUTO (any case) as server-allocated, everything else as typed", () => {
    expect(isAutoVoucherNo(undefined)).toBe(true);
    expect(isAutoVoucherNo("")).toBe(true);
    expect(isAutoVoucherNo("   ")).toBe(true);
    expect(isAutoVoucherNo("AUTO")).toBe(true);
    expect(isAutoVoucherNo("auto")).toBe(true);
    expect(isAutoVoucherNo("JV-2026-001")).toBe(false);
    expect(isAutoVoucherNo("AUTOMATIC-1")).toBe(false);
  });
});

describe("isVoucherNoViolation (pure)", () => {
  it("matches only a 23505 on the voucher_no constraint, directly or wrapped in a cause", () => {
    const pg = { code: "23505", constraint_name: "finance_journals_tenant_id_voucher_no_key" };
    expect(isVoucherNoViolation(pg)).toBe(true);
    expect(isVoucherNoViolation(Object.assign(new Error("wrapped"), { cause: pg }))).toBe(true);
    expect(isVoucherNoViolation({ code: "23505", constraint_name: "finance_journals_pkey" })).toBe(false);
    expect(isVoucherNoViolation({ code: "23503", constraint_name: "finance_journals_tenant_id_voucher_no_key" })).toBe(false);
    expect(isVoucherNoViolation(new Error("boom"))).toBe(false);
    expect(isVoucherNoViolation(null)).toBe(false);
  });
});

describe("POST /v1/finance/journals -- duplicate voucher number", () => {
  it("accepts a fresh typed voucher, then answers 409 DUPLICATE_VOUCHER for the same number and posts nothing more", async () => {
    const app = await buildApp();
    try {
      const first = await app.inject({ method: "POST", url: "/v1/finance/journals", headers: headers(TENANT, randomUUID()), payload: payload(VOUCHER) });
      expect(first.statusCode).toBe(202);
      await drain();
      const stored = await journalsWithVoucher(TENANT, VOUCHER);
      expect(stored).toHaveLength(1);
      expect(stored[0]?.status).toBe("pending_approval");

      const second = await app.inject({ method: "POST", url: "/v1/finance/journals", headers: headers(TENANT, randomUUID()), payload: payload(VOUCHER) });
      expect(second.statusCode).toBe(409);
      const body = second.json();
      expect(body.code).toBe("DUPLICATE_VOUCHER");
      expect(body.retryable).toBe(false);
      expect(body.fieldErrors).toEqual([expect.objectContaining({ field: "voucherNo" })]);
      await drain();
      expect(await journalsWithVoucher(TENANT, VOUCHER)).toHaveLength(1);
    } finally { await app.close(); }
  });

  it("a replay of the SAME request (same idempotency key) is not a duplicate of itself", async () => {
    const app = await buildApp();
    try {
      const key = randomUUID();
      const voucher = `JV-REPLAY-${key.slice(0, 8)}`;
      const first = await app.inject({ method: "POST", url: "/v1/finance/journals", headers: headers(TENANT, key), payload: payload(voucher) });
      expect(first.statusCode).toBe(202);
      await drain();
      const replay = await app.inject({ method: "POST", url: "/v1/finance/journals", headers: headers(TENANT, key), payload: payload(voucher) });
      expect(replay.statusCode).toBe(202);
      await drain();
      expect(await journalsWithVoucher(TENANT, voucher)).toHaveLength(1);
    } finally { await app.close(); }
  });

  it("an omitted or AUTO voucher is never a duplicate (the server allocates it)", async () => {
    const app = await buildApp();
    try {
      for (const v of [undefined, "AUTO", "auto", "AUTO"]) {
        const res = await app.inject({ method: "POST", url: "/v1/finance/journals", headers: headers(TENANT, randomUUID()), payload: payload(v) });
        expect(res.statusCode).toBe(202);
      }
      await drain();
    } finally { await app.close(); }
  });

  it("the same voucher number in another tenant is accepted (uniqueness is per tenant)", async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({ method: "POST", url: "/v1/finance/journals", headers: headers(OTHER_TENANT, randomUUID()), payload: payload(VOUCHER) });
      expect(res.statusCode).toBe(202);
      await drain();
      expect(await journalsWithVoucher(OTHER_TENANT, VOUCHER)).toHaveLength(1);
      expect(await journalsWithVoucher(TENANT, VOUCHER)).toHaveLength(1);
    } finally { await app.close(); }
  });
});

describe("finance.gl.create consumer -- a voucher race is a recorded failure, not a retry loop", () => {
  const RACE_TENANT = randomUUID();
  const IDS = [randomUUID(), randomUUID()];
  const MSGS = [randomUUID(), randomUUID()];
  const CORR = `corr-je06-${randomUUID().slice(0, 8)}`;

  afterAll(async () => {
    await scoped(RACE_TENANT, (tx) => tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, RACE_TENANT)));
    for (const m of MSGS) await db.delete(processed).where(eq(processed.messageId, m));
  });

  it("the second create with the same number audits outcome=failure, does not DLQ or throw, and stores one journal", async () => {
    const q = tenantWrappedQueue();
    registerGlConsumers(q);
    await q.start();
    const base = { tenantId: RACE_TENANT, actorId: MAKER, correlationId: CORR, schemaVersion: "1.0" };
    const cmd = (id: string) => ({
      id, tenantId: RACE_TENANT, voucherNo: "JV-RACE-1", type: "journal", postingDate: "2026-08-15",
      lines: [
        { accountCode: EXPENSE, debitMinor: 150050n, creditMinor: 0n },
        { accountCode: BANK, debitMinor: 0n, creditMinor: 150050n },
      ],
    });
    await q.publish(COMMANDS.journalCreate, { messageId: MSGS[0]!, type: COMMANDS.journalCreate, ...base, payload: cmd(IDS[0]!) });
    await q.drain();
    await q.publish(COMMANDS.journalCreate, { messageId: MSGS[1]!, type: COMMANDS.journalCreate, ...base, payload: cmd(IDS[1]!) });
    await q.drain();
    await q.stop();

    expect(q.dlq.length).toBe(0);
    const rows = await journalsWithVoucher(RACE_TENANT, "JV-RACE-1");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(IDS[0]);

    const outbox = await scoped(RACE_TENANT, (tx) => tx.select().from(outboxMessages).where(eq(outboxMessages.correlationId, CORR)));
    const actions = outbox.map((r) => (r.payload as { action?: string; outcome?: string }));
    expect(actions.filter((a) => a.action === "create_journal_draft" && a.outcome === "success")).toHaveLength(1);
    const rejected = actions.filter((a) => a.action === "create_journal_draft_rejected_duplicate_voucher");
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.outcome).toBe("failure");
  });
});
