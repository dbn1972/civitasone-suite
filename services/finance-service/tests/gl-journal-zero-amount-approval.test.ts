/**
 * Zero-amount GL journal approval — silent-failure fix.
 *
 * PROVEN BUG: a manual journal created with debitMinor:0 / creditMinor:0 on
 * every line passes assertJournalBalances() trivially (0 === 0) and lands
 * pending_approval. A finance_admin (checker) approving it got a 202
 * accepted — but gl/consumer.ts's postJournal() has an early-return for a
 * zero-total journal ("M2", an intentional no-op for AUTOMATED GL-spine
 * postings with a genuine zero net movement — see its comment) that fires
 * BEFORE the code path that flips status to "posted". The journal stayed
 * pending_approval forever with no visible failure anywhere: the approving
 * officer had no way to discover their approval had no effect.
 *
 * FIX (two layers, both proven here):
 *  1. Creation now rejects a zero-amount manual journal outright
 *     (assertJournalHasAmount() — gl/domain.ts — called from
 *     validators.ts's postJournalBody schema, gl/commands.ts createJournal(),
 *     and this file's finance.gl.create handler). A checker is never asked
 *     to approve a draft with nothing to post.
 *  2. Defensive backstop: finance.gl.approve itself now also refuses to
 *     approve an existing pending_approval draft with a zero net amount —
 *     loudly (NonRetryableError -> DLQ), not silently. This covers a draft
 *     that reached pending_approval some other way (legacy data, a future
 *     producer that bypasses layer 1) and proves the exact reported repro
 *     (seed a 0/0 pending_approval row, then approve it) can no longer sit
 *     in limbo — it fails visibly instead.
 *
 * Neither layer touches postJournal()'s own zero-amount no-op, which
 * legitimate AUTOMATED postings (depreciation, payroll settlement, an empty
 * stock entry, ...) still rely on — see tests/gl-budget-check.test.ts and
 * tests/payroll-gl-consumer.test.ts for coverage of that path.
 *
 * Harness mirrors tests/dom-024-gl-journal-maker-checker.test.ts exactly
 * (tenantWrappedQueue, real dev DB via scoped(), account codes UUID-shaped
 * so resolveHeadIdTx's fast path needs no seeded chart-of-accounts row).
 * Uses its own tenant/ids, distinct from that file's, so this file is fully
 * self-contained.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { MemoryQueue, type Handler } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { eq } from "drizzle-orm";
import { db, sqlClient } from "../src/shared/db.js";
import { scoped } from "./_tenant.js";
import { financeJournals } from "../src/modules/gl/schema.js";
import { outboxMessages, processed } from "../src/shared/outbox.js";
import { registerGlConsumers } from "../src/modules/gl/consumer.js";
import { COMMANDS } from "../src/topics.js";

function tenantWrappedQueue(opts?: { maxAttempts?: number }): MemoryQueue {
  const q = new MemoryQueue(opts);
  const rawSubscribe = q.subscribe.bind(q);
  q.subscribe = ((topic: string, handler: Handler) =>
    rawSubscribe(topic, (msg: Parameters<Handler>[0]) => runWithTenant(msg.tenantId, () => handler(msg)))) as typeof q.subscribe;
  return q;
}

const TENANT  = "9a9a9a9a-2222-4000-8000-0000000000d2";
const MAKER   = "00000000-bbbb-4000-8000-0000000d0011";
const CHECKER = "00000000-bbbb-4000-8000-0000000d0022";

const EXPENSE_HEAD = randomUUID();
const BANK_HEAD    = randomUUID();

function zeroLines() {
  return [
    { accountCode: EXPENSE_HEAD, debitMinor: "0", creditMinor: "0" },
    { accountCode: BANK_HEAD,    debitMinor: "0", creditMinor: "0" },
  ];
}

// finance_journals is append-only (no DELETE grant) — fresh randomUUID()s
// per journal/message id, same rationale as dom-024's JRN_A/JRN_B.
const CREATE_JRN     = randomUUID();
const CREATE_MSG     = randomUUID();

const SEEDED_JRN      = randomUUID();
const SEEDED_APPROVE_MSG = randomUUID();

async function clean() {
  await scoped(TENANT, (tx) => tx.delete(outboxMessages).where(eq(outboxMessages.correlationId, "corr-gl-zero")));
  for (const m of [CREATE_MSG, SEEDED_APPROVE_MSG]) {
    await db.delete(processed).where(eq(processed.messageId, m));
  }
}

beforeEach(clean);
afterAll(async () => { await clean(); await sqlClient.end(); });

describe("GL journal zero-amount approval — silent-failure fix", () => {
  it("layer 1: finance.gl.create rejects a $0/$0 draft outright — no pending_approval row is ever created", async () => {
    const q = tenantWrappedQueue({ maxAttempts: 1 });
    registerGlConsumers(q);
    await q.start();

    await q.publish(COMMANDS.journalCreate, {
      messageId: CREATE_MSG, type: COMMANDS.journalCreate,
      tenantId: TENANT, actorId: MAKER, correlationId: "corr-gl-zero", schemaVersion: "1.0",
      payload: {
        id: CREATE_JRN, tenantId: TENANT, voucherNo: "AUTO", type: "journal",
        postingDate: "2027-09-01", lines: zeroLines(),
      },
    });
    await q.drain();
    await q.stop();

    // Rejected loudly (dead-lettered), not silently accepted.
    expect(q.dlq.length).toBe(1);
    expect(q.dlq[0]?.error).toMatch(/JOURNAL_ZERO_AMOUNT/);

    // Nothing was ever persisted for this draft — there is no dangling
    // pending_approval row for a checker to be pointlessly asked to approve.
    const rows = await scoped(TENANT, (tx) => tx.select().from(financeJournals).where(eq(financeJournals.id, CREATE_JRN)));
    expect(rows.length).toBe(0);
  });

  it("layer 2 (defensive backstop): approving a pre-existing $0/$0 pending_approval draft fails loudly instead of silently leaving it stuck forever", async () => {
    // Seed a pending draft directly (bypassing finance.gl.create / layer 1),
    // simulating the exact reported repro / any legacy row that predates
    // this fix — mirrors dom-024's self-approval test's seeding style.
    await scoped(TENANT, (tx) => tx.insert(financeJournals).values({
      id: SEEDED_JRN, tenantId: TENANT, voucherNo: `DRAFT-${SEEDED_JRN}`, type: "journal",
      postingDate: "2027-09-01", lines: zeroLines(), status: "pending_approval",
      createdBy: MAKER, updatedBy: MAKER,
    }));

    const q = tenantWrappedQueue({ maxAttempts: 1 });
    registerGlConsumers(q);
    await q.start();

    await q.publish(COMMANDS.journalApprove, {
      messageId: SEEDED_APPROVE_MSG, type: COMMANDS.journalApprove,
      tenantId: TENANT, actorId: CHECKER, correlationId: "corr-gl-zero", schemaVersion: "1.0",
      payload: { id: SEEDED_JRN, tenantId: TENANT },
    });
    await q.drain();
    await q.stop();

    // THE BUG: this used to drain cleanly (no DLQ entry) with the journal
    // silently left pending_approval forever — a 202 the checker could never
    // learn had no effect. Now it is dead-lettered — visible, discoverable,
    // actionable — instead of vanishing.
    expect(q.dlq.length).toBe(1);
    expect(q.dlq[0]?.error).toMatch(/JOURNAL_ZERO_AMOUNT/);

    // No fabricated post: status is exactly what it was, not silently
    // mutated into something else either.
    const journal = (await scoped(TENANT, (tx) => tx.select().from(financeJournals).where(eq(financeJournals.id, SEEDED_JRN))))[0];
    expect(journal?.status).toBe("pending_approval");
    expect(journal?.updatedBy).toBe(MAKER); // untouched — the approve attempt never got far enough to update it
  });
});
