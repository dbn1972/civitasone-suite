/**
 * Period-close vs. post-journal concurrency race (Critical, DB-verified).
 *
 * BACKGROUND: postJournal (gl/consumer.ts) calls getPeriodStatusTx() once,
 * early, inside its own already-open transaction, then goes on to do
 * substantial further work (idempotency check, gapless voucher allocation,
 * leaf-account guard, budget check) before it ever commits, with no re-check
 * of period status immediately before that commit. A concurrent
 * finance.period.close (hard_close) could run its own upsertPeriodClose and
 * commit in the gap between postJournal's early check and its own later
 * commit, so a journal could post successfully into a period that was, by
 * the time it landed, already hard-closed.
 *
 * Proven live against a real burst, prior to this fix: 6 pending journals
 * approved concurrently with a hard-close (genuine Promise.all, not
 * sequential) left 5 of 6 journals with a posted timestamp AFTER the
 * period's closed_at.
 *
 * FIX: repo.ts's lockPeriodTx — a transaction-scoped Postgres advisory lock
 * keyed on (tenant_id, period) — is now taken by both getPeriodStatusTx
 * (read side) and upsertPeriodClose (write side). See that function's doc
 * comment for why a plain `SELECT ... FOR UPDATE` is not enough (a period
 * can go from zero pre-existing finance_period_close rows straight to
 * closed, and a row lock has nothing to lock until a row exists).
 *
 * TESTING STRATEGY: a real Promise.all burst and hoping the two transactions
 * happen to overlap is exactly the anti-pattern distribution-lock-race.
 * test.ts's header documents catching a broken guard in only 1/8 runs. This
 * file follows that file's approach instead: force genuine overlap
 * deterministically by opening a real transaction, calling the actual
 * (fixed) repo function, and parking that transaction open with a manual
 * gate before the second, real, concurrent transaction is even started. The
 * assertions below prove the *lock* itself serialises the two — not just
 * that final numbers happen to come out right.
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, and } from "drizzle-orm";
import { db, sqlClient } from "../src/shared/db.js";
import { getPeriodStatusTx, upsertPeriodClose } from "../src/modules/period-close/repo.js";
import { financePeriodClose } from "../src/modules/period-close/schema.js";
import { deriveFY } from "../src/modules/reports/routes.js";
import { scoped } from "./_tenant.js";

const TENANT = "c0111000-0000-4000-8000-0000000000c1";
const ACTOR = "c0111000-0000-4000-8000-0000000000aa";
// Distinctive, far-future periods so this file never collides with fixtures
// any other test in the suite might seed for the "current" period.
const PERIOD_A = "2031-07";
const PERIOD_B = "2031-08";
const PERIOD_C = "2031-09";
// Generous, one-directional upper bound on how long an unlocked competing
// transaction would ever take to race past the still-open, parked one --
// same order of magnitude/precedent as distribution-lock-race.test.ts and
// concurrent-writes.test.ts. Not a race the "closed" side might win; if the
// lock is intact it is *definitely* still blocked after this wait.
const OVERLAP_MARGIN_MS = 300;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function deferred<T = void>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

async function cleanup(period: string): Promise<void> {
  await scoped(TENANT, (tx) => tx.delete(financePeriodClose).where(and(
    eq(financePeriodClose.tenantId, TENANT),
    eq(financePeriodClose.period, period),
  )));
}

async function readStatusPlain(period: string): Promise<string | undefined> {
  const rows = await scoped(TENANT, (tx) => tx.select().from(financePeriodClose).where(and(
    eq(financePeriodClose.tenantId, TENANT),
    eq(financePeriodClose.period, period),
  )));
  return rows[0]?.status;
}

function hardCloseRow(period: string) {
  return {
    id: randomUUID(),
    tenantId: TENANT,
    fiscalYear: deriveFY(period),
    period,
    status: "hard_close" as const,
    closedBy: ACTOR,
    closedAt: new Date(),
    createdBy: ACTOR,
  };
}

afterAll(async () => {
  await cleanup(PERIOD_A);
  await cleanup(PERIOD_B);
  await cleanup(PERIOD_C);
  await sqlClient.end();
});

describe("period-close repo — advisory lock closes the post-journal / hard-close race", () => {
  it(
    "a hard-close cannot commit while a postJournal-shaped transaction is still open on the same period, " +
    "even with ZERO pre-existing finance_period_close row",
    async () => {
      await cleanup(PERIOD_A);
      const events: string[] = [];

      const parked = deferred<void>();
      const release = deferred<void>();

      // "postJournal"-shaped transaction: read status through the fixed,
      // lock-acquiring getPeriodStatusTx, then simulate the substantial
      // further work postJournal does before its own commit (idempotency
      // check, voucher allocation, budget check, ...) by parking here with
      // the transaction still open and the advisory lock still held.
      const readerTx = scoped(TENANT, async (tx) => {
        const status = await getPeriodStatusTx(tx, TENANT, PERIOD_A);
        parked.resolve();
        await release.promise;
        events.push("reader-commit");
        return status;
      });

      // Don't start the close until the reader has genuinely acquired the
      // lock and parked inside it -- forced overlap, not hopeful timing.
      await parked.promise;

      const closerTx = scoped(TENANT, async (tx) => {
        await upsertPeriodClose(tx, hardCloseRow(PERIOD_A));
        events.push("closer-commit");
      });

      await wait(OVERLAP_MARGIN_MS);
      // If the lock is intact, closerTx is still blocked waiting on the
      // advisory lock at this point: it must NOT have committed yet.
      expect(events).not.toContain("closer-commit");

      release.resolve();
      const [readerStatus] = await Promise.all([readerTx, closerTx]);

      expect(readerStatus).toBe("open"); // reader legitimately saw the period open
      expect(events).toEqual(["reader-commit", "closer-commit"]); // strict ordering, not just "both eventually happened"

      expect(await readStatusPlain(PERIOD_A)).toBe("hard_close");
      await cleanup(PERIOD_A);
    },
  );

  it(
    "symmetric direction: a postJournal-shaped read blocks until a concurrent hard-close commits, " +
    "then correctly observes hard_close",
    async () => {
      await cleanup(PERIOD_B);
      const events: string[] = [];

      const parked = deferred<void>();
      const release = deferred<void>();

      const closerTx = scoped(TENANT, async (tx) => {
        await upsertPeriodClose(tx, hardCloseRow(PERIOD_B));
        parked.resolve();
        await release.promise;
        events.push("closer-commit");
      });

      await parked.promise;

      const readerTx = scoped(TENANT, async (tx) => {
        const status = await getPeriodStatusTx(tx, TENANT, PERIOD_B);
        events.push("reader-commit");
        return status;
      });

      await wait(OVERLAP_MARGIN_MS);
      // If the lock is intact, the reader is still blocked behind the
      // still-open closer's advisory lock: it must NOT have resolved yet.
      expect(events).not.toContain("reader-commit");

      release.resolve();
      const [, readerStatus] = await Promise.all([closerTx, readerTx]);

      expect(events).toEqual(["closer-commit", "reader-commit"]); // strict ordering
      expect(readerStatus).toBe("hard_close"); // postJournal's PERIOD_CLOSED check (gl/consumer.ts) fires off this

      await cleanup(PERIOD_B);
    },
  );

  it(
    "control (no concurrency): the lock adds no lingering effect on the ordinary sequential path -- " +
    "hard-close commits, and a later, independent transaction immediately observes hard_close",
    async () => {
      await cleanup(PERIOD_C);

      await scoped(TENANT, (tx) => upsertPeriodClose(tx, hardCloseRow(PERIOD_C)));

      // A brand-new, independent transaction: the previous one's advisory
      // lock must already be released (commit-time auto-release), so this
      // must resolve promptly, not hang.
      const status = await scoped(TENANT, (tx) => getPeriodStatusTx(tx, TENANT, PERIOD_C));
      expect(status).toBe("hard_close");

      await cleanup(PERIOD_C);
    },
  );
});
