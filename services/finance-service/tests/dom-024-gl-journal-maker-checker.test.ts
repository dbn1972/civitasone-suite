/**
 * DOM-024 — maker-checker on manual GL journal entries.
 *
 * Gap: POST /v1/finance/journals (manual journal entry) posted straight to
 * the ledger with no second-person approval — unlike every other
 * financial-posting flow in this codebase (sanctions R11, bills/payments
 * C4). A single finance_officer could create AND post a journal entry
 * unattended.
 *
 * This proves:
 *  - finance.gl.create (POST /v1/finance/journals) produces a
 *    `pending_approval` journal (created_by = the maker) — it does NOT
 *    post: no ledger lines, no voucher number allocated, no budget/period
 *    effect.
 *  - a checker (a distinct officer) approving it (finance.gl.approve, PATCH
 *    .../:id/approve) posts it for real: ledger lines land, a gapless
 *    voucher number is allocated, status becomes `posted`, created_by is
 *    unchanged (still the maker — the gl.block_journal_mutation trigger
 *    enforces this).
 *  - the maker approving their OWN draft is rejected (SoD violation -> DLQ);
 *    the draft stays pending_approval and nothing posts.
 *
 * Runs the real gl consumers against the dev DB via a tenant-wrapped
 * MemoryQueue — same shape as tests/tx-018-gl-org-structure-nested-tx
 * -deadlock.test.ts's tenantWrappedQueue() (gl/consumer.ts's
 * registerGlConsumers() does not itself tenant-scope the queue, unlike
 * budget/consumer.ts's registerBudgetConsumers() — production always
 * registers gl consumers against the pre-wrapped queue from
 * shared/infra.js, see services/queue-service/src/bus.ts's
 * withTenantConsumer; a raw MemoryQueue in a test needs the same wrap
 * applied explicitly). Account codes are UUID-shaped so gl/consumer.ts's
 * resolveHeadIdTx() fast-path (UUID_RE.test) resolves them without needing
 * a seeded chart-of-accounts head row — this test is about the
 * maker-checker gate, not the budget check (see
 * tests/journal-budget-override-routes.test.ts) or the leaf-account guard
 * (neither is exercised when the "head" simply isn't budget-controlled /
 * has no children, which is true for an unseeded id).
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { MemoryQueue, type Handler } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { eq } from "drizzle-orm";
import { db, sqlClient } from "../src/shared/db.js";
import { scoped } from "./_tenant.js";
import { assertDistinctMakerChecker, DomainError } from "../src/modules/payments/domain.js";
import { financeJournals, financeLedger } from "../src/modules/gl/schema.js";
import { outboxMessages, processed } from "../src/shared/outbox.js";
import { registerGlConsumers } from "../src/modules/gl/consumer.js";
import { COMMANDS, EVENTS } from "../src/topics.js";

/** Mirrors tx-018-gl-org-structure-nested-tx-deadlock.test.ts's
 *  tenantWrappedQueue() / worker.ts's global subscribe wrap: every handler
 *  runs under the message's tenant GUC so FORCE RLS reads/writes succeed,
 *  exactly like production. */
function tenantWrappedQueue(opts?: { maxAttempts?: number }): MemoryQueue {
  const q = new MemoryQueue(opts);
  const rawSubscribe = q.subscribe.bind(q);
  q.subscribe = ((topic: string, handler: Handler) =>
    rawSubscribe(topic, (msg: Parameters<Handler>[0]) => runWithTenant(msg.tenantId, () => handler(msg)))) as typeof q.subscribe;
  return q;
}

const TENANT  = "9a9a9a9a-1111-4000-8000-0000000000d1";
const MAKER   = "00000000-aaaa-4000-8000-0000000d0011";
const CHECKER = "00000000-aaaa-4000-8000-0000000d0022";
// financeLedger is ALSO append-only, so — same rationale as JRN_A/JRN_B
// below — each test gets its OWN fresh, distinct pair of "head" account
// codes: reusing one across the create-then-approve test (which legitimately
// posts a real ledger line) and the self-approval-rejected test (which must
// prove NOTHING posted) would let the first test's real, permanent ledger
// row satisfy the second test's "nothing posted for this head" assertion by
// coincidence.
const EXPENSE_HEAD_1 = randomUUID();
const BANK_HEAD_1    = randomUUID();
const EXPENSE_HEAD_2 = randomUUID();
const BANK_HEAD_2    = randomUUID();

// finance_journals is deliberately immutable/append-only (finance_svc holds
// no DELETE grant — see clean()'s comment below, and every other gl test
// file's identical note), so — exactly like
// tests/tx-018-gl-org-structure-nested-tx-deadlock.test.ts's JOURNAL_IDS —
// these are freshly randomUUID()'d per test run rather than fixed
// constants: a fixed id would collide with a prior run's now-undeletable
// row (or, since finance_journals also has UNIQUE(tenant_id, voucher_no),
// with that prior row's allocated voucher number) the moment this suite
// runs twice against the same persistent Postgres instance.
const JRN_A = randomUUID();
const CREATE_MSG_A  = randomUUID();
const APPROVE_MSG_A = randomUUID();

const JRN_B = randomUUID();
const SELF_MSG_B = randomUUID();

function journalLines(expenseHead: string, bankHead: string) {
  return [
    { accountCode: expenseHead, debitMinor: "50000", creditMinor: "0" },
    { accountCode: bankHead, debitMinor: "0", creditMinor: "50000" },
  ];
}

async function clean() {
  // financeJournals/financeLedger are deliberately append-only (finance_svc
  // has no DELETE grant — see JRN_A/JRN_B's comment above) so there is
  // nothing to remove there; outbox/processed rows are ordinary tables and
  // are cleared defensively (harmless no-op the first time this runs).
  await scoped(TENANT, (tx) => tx.delete(outboxMessages).where(eq(outboxMessages.correlationId, "corr-dom024")));
  for (const m of [CREATE_MSG_A, APPROVE_MSG_A, SELF_MSG_B]) {
    await db.delete(processed).where(eq(processed.messageId, m));
  }
}

beforeEach(clean);
afterAll(async () => { await clean(); await sqlClient.end(); });

describe("DOM-024 journal maker-checker (R11) — consumer", () => {
  it("finance.gl.create drafts pending_approval with NO ledger effect, then a distinct checker approves and it posts for real", async () => {
    const q = tenantWrappedQueue();
    registerGlConsumers(q);
    await q.start();

    await q.publish(COMMANDS.journalCreate, {
      messageId: CREATE_MSG_A, type: COMMANDS.journalCreate,
      tenantId: TENANT, actorId: MAKER, correlationId: "corr-dom024", schemaVersion: "1.0",
      payload: {
        id: JRN_A, tenantId: TENANT, voucherNo: "AUTO", type: "journal",
        postingDate: "2027-08-15", lines: journalLines(EXPENSE_HEAD_1, BANK_HEAD_1),
      },
    });
    await q.drain();

    let journal = (await scoped(TENANT, (tx) => tx.select().from(financeJournals).where(eq(financeJournals.id, JRN_A))))[0];
    expect(journal?.status).toBe("pending_approval");
    expect(journal?.createdBy).toBe(MAKER);
    // Not yet allocated — see DOM-010. A unique-per-row placeholder (not the
    // literal "AUTO"), since finance_journals has UNIQUE(tenant_id,
    // voucher_no) and a second concurrently-pending draft must not collide
    // with this one before either is approved.
    expect(journal?.voucherNo).toBe(`DRAFT-${JRN_A}`);

    // Nothing posted yet: no ledger lines for this draft under any voucher.
    const ledgerForThisJournal = await scoped(TENANT, (tx) => tx.select().from(financeLedger).where(eq(financeLedger.tenantId, TENANT)));
    expect(ledgerForThisJournal.filter((l) => l.createdBy === MAKER && l.debitMinor === 50000n).length).toBe(0);

    // A genuinely distinct checker approves.
    await q.publish(COMMANDS.journalApprove, {
      messageId: APPROVE_MSG_A, type: COMMANDS.journalApprove,
      tenantId: TENANT, actorId: CHECKER, correlationId: "corr-dom024", schemaVersion: "1.0",
      payload: { id: JRN_A, tenantId: TENANT },
    });
    await q.drain();
    await q.stop();

    journal = (await scoped(TENANT, (tx) => tx.select().from(financeJournals).where(eq(financeJournals.id, JRN_A))))[0];
    expect(journal?.status).toBe("posted");
    expect(journal?.createdBy).toBe(MAKER); // immutable — the checker never becomes the maker of record
    expect(journal?.updatedBy).toBe(CHECKER);
    // Gapless number allocated at approval time — no longer the draft placeholder.
    expect(journal?.voucherNo).not.toBe(`DRAFT-${JRN_A}`);
    expect(journal?.voucherNo?.startsWith("DRAFT-")).toBe(false);

    const ledger = await scoped(TENANT, (tx) => tx.select().from(financeLedger).where(eq(financeLedger.voucherNo, journal!.voucherNo)));
    expect(ledger.length).toBe(2);
    expect(ledger.some((l) => l.headId === EXPENSE_HEAD_1 && l.debitMinor === 50000n)).toBe(true);
    expect(ledger.some((l) => l.headId === BANK_HEAD_1 && l.creditMinor === 50000n)).toBe(true);

    const events = await scoped(TENANT, (tx) => tx.select().from(outboxMessages).where(eq(outboxMessages.correlationId, "corr-dom024")));
    expect(events.map((e) => e.eventType)).toContain(EVENTS.glPosted);
  });

  it("rejects self-approval by the maker (SoD) — journal stays pending_approval, nothing posts", async () => {
    // Seed a pending draft created by MAKER (equivalent to finance.gl.create
    // having already run — isolates this test from the create step above).
    // voucher_no mirrors what that handler actually stores for an
    // AUTO-requested draft (see finance.gl.create's DRAFT-<id> placeholder,
    // not the literal "AUTO" — UNIQUE(tenant_id, voucher_no) forbids that).
    await scoped(TENANT, (tx) => tx.insert(financeJournals).values({
      id: JRN_B, tenantId: TENANT, voucherNo: `DRAFT-${JRN_B}`, type: "journal",
      postingDate: "2027-08-15", lines: journalLines(EXPENSE_HEAD_2, BANK_HEAD_2), status: "pending_approval",
      createdBy: MAKER, updatedBy: MAKER,
    }));

    const q = tenantWrappedQueue({ maxAttempts: 1 });
    registerGlConsumers(q);
    await q.start();

    await q.publish(COMMANDS.journalApprove, {
      messageId: SELF_MSG_B, type: COMMANDS.journalApprove,
      tenantId: TENANT, actorId: MAKER, correlationId: "corr-dom024", schemaVersion: "1.0",
      payload: { id: JRN_B, tenantId: TENANT },
    });
    await q.drain();
    await q.stop();

    expect(q.dlq.length).toBe(1);
    expect(q.dlq[0]?.error).toMatch(/MAKER_CHECKER_VIOLATION/);

    const journal = (await scoped(TENANT, (tx) => tx.select().from(financeJournals).where(eq(financeJournals.id, JRN_B))))[0];
    expect(journal?.status).toBe("pending_approval"); // unchanged

    const ledger = await scoped(TENANT, (tx) => tx.select().from(financeLedger).where(eq(financeLedger.tenantId, TENANT)));
    expect(ledger.some((l) => l.headId === EXPENSE_HEAD_2 && l.debitMinor === 50000n)).toBe(false);
  });
});

describe("DOM-024 SoD (R11) — pure (reuses payments/domain.js's assertDistinctMakerChecker, exactly as journalReverse already does)", () => {
  it("rejects self-approval (maker == checker)", () => {
    expect(() => assertDistinctMakerChecker(MAKER, MAKER)).toThrowError(/MAKER_CHECKER_VIOLATION/);
  });
  it("allows a distinct checker", () => {
    expect(() => assertDistinctMakerChecker(MAKER, CHECKER)).not.toThrow();
  });
  it("throws a DomainError type", () => {
    expect(() => assertDistinctMakerChecker(MAKER, MAKER)).toThrowError(DomainError);
  });
});
