/**
 * masters/consumer.ts — COMMANDS.openingBalancesEnter concurrent-submission
 * silent-data-loss regression (real Postgres, no mocks).
 *
 * PROVEN INCIDENT: two finance_admins submitted opening balances for the
 * identical account+fiscal-year (fyCode 2027-28, accounts 1100/2202) with
 * different amounts, concurrently. Only the first request's amounts
 * persisted. The second got 202 accepted, but its data existed nowhere -- no
 * row, no error, no server log trace either way.
 *
 * ROOT CAUSE (verified directly against this repo's own migrations and a
 * fresh Postgres built from them -- NOT assumed): gl.finance_opening_balances
 * DOES carry `UNIQUE (tenant_id, fy_code, account_code)` (migrations/
 * 0022_fy_opening_balance.sql, present since that file's very first commit,
 * never dropped). The bug is not a missing constraint -- it's that the
 * consumer's per-entry `.onConflictDoNothing()` has no conflict target, so
 * (per Postgres semantics) it silently catches ANY unique-constraint
 * violation on the table, including this natural-key one, and the handler
 * never inspects whether the insert actually affected a row. The whole
 * transaction (including the outbox audit event, logged as "success") then
 * commits as if nothing was wrong. Contrast with this same file's
 * COMMANDS.fiscalYearCreate handler a few lines up, which already relies on
 * the identical bare-onConflictDoNothing-catches-the-natural-key mechanism
 * but actually checks `.returning().length` and throws ALREADY_EXISTS when
 * it's zero -- openingBalancesEnter is missing that check.
 *
 * A naive Promise.all against MemoryQueue does NOT need a deterministic
 * barrier (contrast distribution-lock-race.test.ts's TOCTOU
 * SELECT-then-INSERT race, which genuinely needs one): INSERT ... ON
 * CONFLICT is conflict-safe under Postgres regardless of exact interleaving
 * -- whichever transaction's INSERT commits second against the same natural
 * key deterministically loses, whether the two truly overlap in wall-clock
 * time or run back-to-back. That determinism is exactly why this test does
 * not assert which submitter (A or B) wins -- only that EXACTLY one full,
 * internally-consistent submission persists and the other is now cleanly,
 * traceably rejected instead of silently vanishing.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { pgSchema, uuid, varchar, bigint, text, timestamp, integer } from "drizzle-orm/pg-core";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { registerMastersConsumers } from "../src/modules/masters/consumer.js";
import { COMMANDS } from "../src/topics.js";

// Mirrors the inline table definition already duplicated in fy-routes.ts and
// consumer.ts (masters/schema.ts does not export this table) -- kept minimal,
// just enough to seed/read/clean up directly.
const glSchema = pgSchema("gl");
const openingBalances = glSchema.table("finance_opening_balances", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  fyCode: varchar("fy_code", { length: 9 }).notNull(),
  accountCode: varchar("account_code", { length: 20 }).notNull(),
  debitMinor: bigint("debit_minor", { mode: "bigint" }).notNull().default(0n),
  creditMinor: bigint("credit_minor", { mode: "bigint" }).notNull().default(0n),
  narration: text("narration"),
  enteredAt: timestamp("entered_at", { withTimezone: true }).notNull().defaultNow(),
  enteredBy: uuid("entered_by").notNull(),
  version: integer("version").notNull().default(1),
});

const TENANT = "70000000-0ba1-4000-8000-0000000000ce";
const ACTOR_A = "70000000-0ba1-4000-8000-00000000a001";
const ACTOR_B = "70000000-0ba1-4000-8000-00000000a002";
const FY_CODE = "2027-28";

async function cleanup(): Promise<void> {
  await runWithTenant(TENANT, () =>
    db.transaction((tx) =>
      tx.delete(openingBalances).where(and(eq(openingBalances.tenantId, TENANT), eq(openingBalances.fyCode, FY_CODE))),
    ),
  );
}

function makeMsg(actorId: string, payload: Record<string, unknown>) {
  return {
    messageId: randomUUID(), type: COMMANDS.openingBalancesEnter, tenantId: TENANT,
    actorId, correlationId: randomUUID(), schemaVersion: "1.0", payload,
  };
}

/** Mirrors worker.ts's global subscribe wrap (see nested-tx-deadlock.test.ts):
 *  every handler runs under the message's tenant GUC so FORCE RLS reads/writes
 *  succeed, exactly like production. Without this, gl.finance_opening_balances'
 *  tenant_isolation_policy WITH CHECK fails on every insert regardless of the
 *  conflict this test is actually targeting. */
function tenantWrappedQueue(opts: { maxAttempts?: number } = {}): MemoryQueue {
  const q = new MemoryQueue(opts);
  const rawSubscribe = q.subscribe.bind(q);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (q as any).subscribe = (topic: string, handler: (msg: any) => Promise<void>) =>
    rawSubscribe(topic, (msg: any) => runWithTenant(msg.tenantId, () => handler(msg)));
  return q;
}

beforeEach(cleanup);
afterAll(async () => { await cleanup(); await sqlClient.end(); });

describe("COMMANDS.openingBalancesEnter consumer — concurrent-submission race (real DB, no mocks)", () => {
  it("two concurrent submissions for the same tenant+FY+account, different amounts: exactly one persists cleanly, the other is traceably rejected (no silent loss)", async () => {
    const q = tenantWrappedQueue({ maxAttempts: 1 });
    registerMastersConsumers(q);
    await q.start();

    // Same shape as the actual proven incident: two DIFFERENT finance_admins,
    // same fyCode + same two account codes, different amounts. Each entry
    // set carries FRESH randomUUID() ids per entry, exactly like fy-routes.ts
    // generates for every independent HTTP submission.
    const submissionA = [
      { id: randomUUID(), accountCode: "1100", debitMinor: 500000, creditMinor: 0, narration: "submitter A" },
      { id: randomUUID(), accountCode: "2202", debitMinor: 0, creditMinor: 500000, narration: "submitter A" },
    ];
    const submissionB = [
      { id: randomUUID(), accountCode: "1100", debitMinor: 999900, creditMinor: 0, narration: "submitter B" },
      { id: randomUUID(), accountCode: "2202", debitMinor: 0, creditMinor: 999900, narration: "submitter B" },
    ];

    await Promise.all([
      q.publish(COMMANDS.openingBalancesEnter, makeMsg(ACTOR_A, { id: randomUUID(), tenantId: TENANT, fyCode: FY_CODE, entries: submissionA })),
      q.publish(COMMANDS.openingBalancesEnter, makeMsg(ACTOR_B, { id: randomUUID(), tenantId: TENANT, fyCode: FY_CODE, entries: submissionB })),
    ]);
    await q.drain();

    const rows = await runWithTenant(TENANT, () =>
      db.transaction((tx) =>
        tx.select().from(openingBalances)
          .where(and(eq(openingBalances.tenantId, TENANT), eq(openingBalances.fyCode, FY_CODE))),
      ),
    );

    // Never a mix of both submissions, never both fully persisted, never
    // neither -- exactly one account code (1100) exists exactly once with a
    // debit, and its sibling (2202) exists exactly once with the SAME
    // submitter's credit. A silent-loss OR silent-corruption regression here
    // would show up as: byAccount.size !== 2, or the two rows disagreeing
    // about which submitter's amount they carry.
    expect(rows.length).toBe(2);
    const byAccount = new Map(rows.map((r) => [r.accountCode, r]));
    expect(byAccount.size).toBe(2);

    const cash = byAccount.get("1100")!;
    const persistedIsA = cash.debitMinor === 500000n;
    const persistedIsB = cash.debitMinor === 999900n;
    expect(persistedIsA || persistedIsB).toBe(true);

    const winningSet = persistedIsA ? submissionA : submissionB;
    for (const entry of winningSet) {
      const row = byAccount.get(entry.accountCode)!;
      expect(row.debitMinor).toBe(BigInt(entry.debitMinor));
      expect(row.creditMinor).toBe(BigInt(entry.creditMinor));
    }

    // The loser must be TRACEABLE -- this is the actual bug fix. Before the
    // fix, this queue's dlq is empty: the losing submission's insert is
    // silently swallowed by the bare onConflictDoNothing(), the transaction
    // commits, the outbox audit event still logs "success", and NOTHING
    // anywhere records that the second finance_admin's numbers never landed.
    expect(q.dlq.length).toBe(1);
    expect(q.dlq[0]!.error).toContain("OPENING_BALANCE_ALREADY_EXISTS");

    await q.stop();
  });
});
