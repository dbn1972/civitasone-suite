import { randomUUID } from "node:crypto";
import type { Queue, CommandEnvelope } from "@civitasone/queue";
import { NonRetryableError } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS, CONSUMED_EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import * as budgetRepo from "../budget/repo.js";
import { assertJournalBalances, assertJournalHasAmount } from "./domain.js";
import { assertBudgetNotExceeded, availableBalance, DomainError } from "../budget/domain.js";
import { assertDistinctMakerChecker } from "../payments/domain.js";
import { getPeriodStatusTx } from "../period-close/repo.js";
import { nextVoucherNo, fyFromDate } from "../hoa/voucher.js";
import { deterministicId } from "./spine.js";
import type { JournalLine } from "./schema.js";
import { validateOrgAssignmentTx } from "../org-structure/domain.js";

const AUDIT_TOPIC = "audit.event.record";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolve a line's accountCode to a head UUID for the uuid head_id ledger column.
 * GL-spine callers (bills/payments/challans) already pass UUIDs and pass through
 * unchanged. The depreciation / asset-disposal / manual-journal paths build
 * lines from raw 4-digit account CODES — previously these were inserted straight
 * into the uuid head_id column and the row dead-lettered. We now resolve the
 * code to its head UUID via the per-tenant master; an unknown code is cleanly
 * rejected with a clear error instead of poisoning the queue.
 */
async function resolveHeadIdTx(tx: unknown, tenantId: string, accountCode: string): Promise<string> {
  if (UUID_RE.test(accountCode)) return accountCode;
  const head = await budgetRepo.findHeadByCodeTx(
    tx as Parameters<typeof budgetRepo.findHeadByCodeTx>[0], tenantId, accountCode,
  );
  if (!head) throw new Error(`UNKNOWN_ACCOUNT_CODE: head code ${accountCode} not found for tenant ${tenantId}`);
  return head.id;
}

const DEP_EXPENSE = process.env.FINANCE_DEP_EXPENSE_CODE ?? "5100";
const DEP_EXPENSE_STAT = process.env.FINANCE_STAT_DEP_EXPENSE_CODE ?? "5101";
const ACCUM_DEP = process.env.FINANCE_ACCUM_DEP_CODE ?? "1250";
const FIXED_ASSET = process.env.FINANCE_FIXED_ASSET_CODE ?? "1200";
const GAIN_LOSS = process.env.FINANCE_GAIN_LOSS_CODE ?? "4200";
const CASH = process.env.FINANCE_CASH_CODE ?? "1100";

type StandardJournal = {
  id: string; tenantId: string; voucherNo: string; type: string;
  postingDate: string; lines: JournalLine[]; reversesId?: string;
  legalEntityId?: string; costCenterId?: string; profitCenterId?: string; operatingUnitId?: string;
  // DOM-007: explicit, audited override of the per-head budget check below.
  // Only reachable from POST /v1/finance/journals — gl/routes.ts requires
  // BUDGET_OVERRIDE_ROLES before a command carrying budgetOverride=true is
  // ever enqueued, so by the time it reaches this consumer the override is
  // already authorized; this flag is not itself an authorization check.
  budgetOverride?: boolean; overrideReason?: string;
};

async function postJournal(
  tx: Parameters<typeof markProcessed>[0],
  msg: CommandEnvelope,
  journal: StandardJournal,
): Promise<void> {
  assertJournalBalances(journal.lines);
  // ERP org-structure validation: if a legal entity is assigned, verify all org refs belong to it.
  // TX-018: routed through the *Tx sibling, threading this function's own
  // already-open `tx` through instead of validateOrgAssignment() opening its
  // own nested db.transaction() (and, transitively, each of the 4 asserts it
  // calls doing the same) from inside this already-open one — see
  // validateOrgAssignmentTx()'s doc comment (org-structure/domain.ts).
  await validateOrgAssignmentTx(tx as unknown as Parameters<typeof validateOrgAssignmentTx>[0], journal.tenantId, {
    legalEntityId: journal.legalEntityId ?? null,
    costCenterId: journal.costCenterId ?? null,
    profitCenterId: journal.profitCenterId ?? null,
    operatingUnitId: journal.operatingUnitId ?? null,
  });
  // M2: lines must be non-negative and the journal must move money. A balanced
  // 0==0 journal (or negative legs) posts an empty / nonsensical voucher — reject.
  let totalDebit = 0n;
  for (const l of journal.lines) {
    const dr = BigInt(l.debitMinor);
    const cr = BigInt(l.creditMinor);
    if (dr < 0n || cr < 0n) {
      throw new Error("JOURNAL_NEGATIVE_LINE: debit/credit amounts must be non-negative");
    }
    totalDebit += dr;
  }
  if (totalDebit === 0n) {
    // INT-FIX: an empty (0==0) journal has nothing to post. This occurs when an
    // upstream producer emits an accrual for a source with zero net movement
    // (e.g. a payroll run approved with no slips, or an empty stock entry).
    // Treat it as a harmless no-op: ack and skip posting instead of throwing,
    // which previously dead-lettered the message and let it retry forever.
    // Unbalanced journals (dr != cr) are still rejected above by
    // assertJournalBalances; negative legs are still rejected above. A genuinely
    // empty journal is noise, not corruption.
    return;
  }
  const period = journal.postingDate.slice(0, 7);
  const periodStatus = await getPeriodStatusTx(tx, journal.tenantId, period);
  if (periodStatus === "unknown") {
    // DOM-010: fail CLOSED on a period the system does not even recognise
    // (e.g. a malformed/garbled YYYY-MM sliced from a bad postingDate)
    // instead of silently treating it as open. getPeriodStatusTx only
    // returns "unknown" for a period string that isn't shaped like a real
    // period at all — a well-formed period with simply no close record yet
    // is still correctly "open" and unaffected by this check.
    throw new Error(`PERIOD_UNKNOWN: cannot post to unrecognized period '${period}'`);
  }
  if (periodStatus === "hard_close") {
    throw new Error(`PERIOD_CLOSED: cannot post to hard-closed period ${period}`);
  }
  if (periodStatus === "soft_close" && !(["adjustment", "closing"].includes(journal.type))) {
    throw new Error(`PERIOD_SOFT_CLOSED: only adjustment/closing journals allowed in soft-closed period ${period}`);
  }
  // Idempotency: a journal id is deterministic for GL-spine postings (keyed off
  // the source doc). If it already exists and is already posted/reversed, this
  // is a redelivery — skip silently so bills/payments/receipts never double-post.
  //
  // DOM-024: a manual maker-checker draft (finance.gl.create, see
  // registerGlConsumers below) pre-inserts this exact journal.id as
  // `pending_approval`. That is NOT a redelivery — it is the one legitimate
  // case where an existing row must still fall through everything below and
  // get posted (see the `existing` branch at the persistence step near the
  // end of this function). Only a row that is already `posted`/`reversed`
  // short-circuits here.
  //
  // DOM-007 fixup: the budget-check block below MUST run after this
  // short-circuit, not before it. A redelivered command (same journal.id,
  // already posted, but a brand-new messageId — exactly what a real
  // outbox/queue redelivery looks like, since markProcessed's dedup is
  // messageId-based, not journal-id-based) needs to hit this return and
  // skip everything downstream, including the budget check. Running the
  // budget check before this line meant a redelivery — where insertJournal
  // itself correctly no-ops — still called incrementBudgetUtilisedGuarded /
  // incrementBudgetUtilisedForced a SECOND time, silently double-counting
  // utilised_minor for a journal that was only ever posted once. See
  // tests/gl-budget-check.test.ts's "redelivery of an already-posted
  // journal (fixup)" regression test.
  //
  // DOM-010 fixup: gapless voucher-number allocation used to run BEFORE
  // this short-circuit. A retried/redelivered command (or a duplicate
  // client request that races a redelivery) would allocate — and
  // permanently burn — a brand-new sequential voucher number for a journal
  // that was then discovered, one line down, to already exist and get
  // skipped. The number is gone forever (the counter never rolls back),
  // leaving a hole in what is supposed to be a gapless sequence. Voucher
  // allocation now happens AFTER this idempotency check, so a message this
  // short-circuit ends never touches the counter at all.
  const existing = await repo.findJournalByIdTx(tx, journal.id);
  if (existing && existing.status !== "pending_approval") return;
  // Gapless voucher numbering: if the caller did not supply a voucher number
  // (or asked for AUTO — including DOM-024's `DRAFT-<id>` placeholder, which
  // finance.gl.create writes in place of a literal "AUTO" specifically so two
  // concurrently-pending manual drafts for the same tenant don't collide on
  // finance_journals' UNIQUE(tenant_id, voucher_no) before either is
  // approved), allocate a strictly-sequential one under a row lock.
  let voucherNo = journal.voucherNo;
  if (!voucherNo || voucherNo.trim() === "" || voucherNo.toUpperCase() === "AUTO" || voucherNo.startsWith("DRAFT-")) {
    const fy = fyFromDate(journal.postingDate);
    const series = (journal.type || "JV").slice(0, 8).toUpperCase();
    const allocated = await nextVoucherNo(
      tx as unknown as Parameters<typeof nextVoucherNo>[0],
      journal.tenantId, fy, series,
    );
    voucherNo = allocated.voucherNo;
  }
  // DOM-010: leaf-account guard. A head with children in the
  // chart-of-accounts hierarchy (finance_heads.parent_id pointing at it) is
  // a group/summary account — posting to it directly would silently corrupt
  // roll-up totals for its children. Checked for every line, debit or
  // credit, not just the debit-only set the budget check below cares about.
  for (const l of journal.lines) {
    const headId = await resolveHeadIdTx(tx, journal.tenantId, l.accountCode);
    if (await budgetRepo.hasChildHeadsTx(tx as Parameters<typeof budgetRepo.hasChildHeadsTx>[0], headId)) {
      throw new DomainError(
        "NOT_LEAF_ACCOUNT",
        `cannot post to non-leaf account '${l.accountCode}' — it has child accounts in the chart of accounts`,
      );
    }
  }
  // DOM-007: budget check (skill 01 "every commit must call check_budget").
  // Granularity is per budget head (tenant_id, head_id, fy) — the same grain
  // finance_budgets itself is keyed at (UNIQUE(tenant_id, head_id, fy)) and
  // the grain grant-service's assertWithinAllocation checks a distribution
  // against its single allocation. Debit lines only: a budget head is
  // consumed by expenditure (the debit side); a credit line never draws it
  // down. Multiple lines against the same head in one entry are summed
  // before the check so a multi-line journal can't split a single overdraw
  // across lines to dodge it. A head with no finance_budgets row for this FY
  // is not budget-controlled — skipped, matching skill 01's posting
  // algorithm ("UPDATE finance_budgets.consumed (if budget controlled)").
  {
    const fy = fyFromDate(journal.postingDate);
    const perHeadDebit = new Map<string, bigint>();
    for (const l of journal.lines) {
      const dr = BigInt(l.debitMinor);
      if (dr <= 0n) continue;
      const headId = await resolveHeadIdTx(tx, journal.tenantId, l.accountCode);
      perHeadDebit.set(headId, (perHeadDebit.get(headId) ?? 0n) + dr);
    }
    for (const [headId, requested] of perHeadDebit) {
      // findBudgetTx (not findBudget) — runs against this already-open tx
      // instead of opening its own nested transaction. See findBudgetTx's
      // doc comment in budget/repo.ts.
      const budget = await budgetRepo.findBudgetTx(
        tx as Parameters<typeof budgetRepo.findBudgetTx>[0], headId, fy, journal.tenantId,
      );
      if (!budget) continue; // head not budget-controlled for this FY
      const available = availableBalance({ reMinor: budget.reMinor, utilisedMinor: budget.utilisedMinor });
      if (journal.budgetOverride) {
        if (requested > available) {
          // Explicit, audited override — mirrors the period-close "reopen"
          // convention (elevated role gated upstream + a logged reason) for
          // the GL core's other bypass-of-a-normal-control action, rather
          // than inventing a new bypass shape.
          await enqueue(tx, {
            topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
            tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
            payload: {
              service: "finance", action: "post_journal_budget_override", resourceType: "budget",
              resourceId: budget.id, outcome: "success",
              headId, fy, requestedMinor: requested.toString(), availableMinor: available.toString(),
              reason: journal.overrideReason ?? null,
            },
          });
        }
        await budgetRepo.incrementBudgetUtilisedForced(
          tx as Parameters<typeof budgetRepo.incrementBudgetUtilisedForced>[0], budget.id, requested, msg.actorId,
        );
      } else {
        assertBudgetNotExceeded(available, requested);
        const ok = await budgetRepo.incrementBudgetUtilisedGuarded(
          tx as Parameters<typeof budgetRepo.incrementBudgetUtilisedGuarded>[0], budget.id, requested, msg.actorId,
        );
        if (!ok) {
          // Lost a race to a concurrent posting against the same head between
          // the read above and this guarded write — re-assert, unauthorized.
          throw new DomainError(
            "BUDGET_EXCEEDED",
            `requested ${requested} paise exceeds available budget for head ${headId} (concurrent posting)`,
          );
        }
      }
    }
  }
  if (existing) {
    // DOM-024: finalizing a manual maker-checker draft — UPDATE the existing
    // pending_approval row in place instead of a second INSERT (its id
    // already exists). created_by (the maker) is left untouched, which the
    // gl.block_journal_mutation trigger additionally enforces as immutable;
    // only status/voucher_no/updated_by/updated_at change. msg.actorId here
    // is the CHECKER (registerGlConsumers's finance.gl.approve handler
    // already asserted checker !== creator before calling this function).
    await repo.markPendingJournalPosted(tx, journal.id, { voucherNo, updatedBy: msg.actorId });
  } else {
    await repo.insertJournal(tx, {
      id: journal.id, tenantId: journal.tenantId, voucherNo,
      type: journal.type, postingDate: journal.postingDate, lines: journal.lines,
      status: "posted", createdBy: msg.actorId, updatedBy: msg.actorId,
      budgetOverride: journal.budgetOverride ?? false, overrideReason: journal.overrideReason ?? null,
      ...(journal.reversesId ? { reversesId: journal.reversesId } : {}),
      ...(journal.legalEntityId ? { legalEntityId: journal.legalEntityId } : {}),
      ...(journal.costCenterId ? { costCenterId: journal.costCenterId } : {}),
      ...(journal.profitCenterId ? { profitCenterId: journal.profitCenterId } : {}),
      ...(journal.operatingUnitId ? { operatingUnitId: journal.operatingUnitId } : {}),
    });
  }
  for (const line of journal.lines) {
    // P5: resolve raw account codes -> head UUIDs so the depreciation / disposal
    // / manual-journal paths post instead of dead-lettering on the uuid column.
    const headId = await resolveHeadIdTx(tx, journal.tenantId, line.accountCode);
    await repo.insertLedgerLine(tx, {
      id: randomUUID(), tenantId: journal.tenantId,
      headId,
      debitMinor: BigInt(line.debitMinor), creditMinor: BigInt(line.creditMinor),
      balanceMinor: BigInt(line.debitMinor) - BigInt(line.creditMinor),
      voucherNo, postingDate: journal.postingDate,
      createdBy: msg.actorId, updatedBy: msg.actorId,
    });
    // Denormalized journal line (eliminates CROSS JOIN LATERAL for asset/report queries).
    const head = await budgetRepo.findHeadByIdTx(tx as Parameters<typeof budgetRepo.findHeadByIdTx>[0], headId);
    await repo.insertJournalLine(tx, {
      id: randomUUID(), tenantId: journal.tenantId, journalId: journal.id, headId,
      debitMinor: BigInt(line.debitMinor), creditMinor: BigInt(line.creditMinor),
      narration: line.narration ?? null, postingDate: journal.postingDate, journalType: journal.type,
      ...(head?.code ? { headCode: head.code } : {}),
      ...(head?.name ? { headName: head.name } : {}),
      ...(head?.classification ? { headClassification: head.classification } : {}),
    });
  }
  await enqueue(tx, {
    topic: EVENTS.glPosted, eventType: EVENTS.glPosted,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { journalId: journal.id, voucherNo },
  });
  await enqueue(tx, {
    topic: EVENTS.transactionPosted, eventType: EVENTS.transactionPosted,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { journalId: journal.id, voucherNo, type: journal.type, postingDate: journal.postingDate, tenantId: journal.tenantId },
  });
  await enqueue(tx, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "finance", action: "post_journal", resourceType: "journal", resourceId: journal.id, outcome: "success" },
  });
}

export function registerGlConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.journalPost, async (msg) => {
    const raw = msg.payload as Record<string, unknown>;

    if (raw.type === "depreciation") {
      const dep = raw as {
        assetId: string; period: string; depAmountMinor: string; currency?: string; depBook?: string;
      };
      // M1: carry paise as a decimal string -> BigInt (no Number() on aggregate paise).
      const amount = BigInt(dep.depAmountMinor);
      const expenseCode = dep.depBook === "statutory" ? DEP_EXPENSE_STAT : DEP_EXPENSE;
      // C1: deterministic journal id keyed off the depreciation source so an
      // outbox redelivery hits the journal PK and no-ops (mirrors the GL spine).
      const depKey = `depreciation:${dep.assetId}:${dep.period}:${dep.depBook ?? "company"}`;
      const journalId = deterministicId(depKey);
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await postJournal(tx, msg, {
          id: journalId,
          tenantId: msg.tenantId,
          voucherNo: `DEP/${dep.depBook ?? "company"}/${dep.period}/${String(dep.assetId).slice(0, 8)}`,
          type: "depreciation",
          postingDate: `${dep.period}-28`,
          lines: [
            { accountCode: expenseCode, debitMinor: amount.toString(), creditMinor: "0" },
            { accountCode: ACCUM_DEP, debitMinor: "0", creditMinor: amount.toString() },
          ],
        });
      });
      await cache.invalidate(cache.makeKey(msg.tenantId, "gl_trial_balance", msg.tenantId));
      // BUG FIX (review follow-up): listFinancialStatements caches under a
      // sibling "gl_financial_statements" key (gl/queries.ts) with no
      // invalidation anywhere -- proven live to serve up to 30s of stale
      // data after a real posting. Invalidated at every point
      // gl_trial_balance already is, since both derive from the same
      // gl.finance_ledger rows this posting just changed.
      await cache.invalidate(cache.makeKey(msg.tenantId, "gl_financial_statements", msg.tenantId));
      // BUG FIX (Medium finding, GL dashboard + Chart of Accounts stale
      // figures): the finance dashboard's KPI cards (getDashboard,
      // dashboard/queries.ts, "dashboard:summary", 30s TTL) and Chart of
      // Accounts' per-account balances (listAccounts, budget/queries.ts,
      // "accounts:list:*", 60s TTL) both derive from these same
      // gl.finance_ledger rows -- neither was ever invalidated anywhere in
      // this consumer, the same cache-invalidation-gap class PR #1565's
      // review found (and this file already fixed for gl_financial_statements
      // above). Invalidated at every point gl_trial_balance already is, same
      // as that fix.
      await cache.invalidateResource(msg.tenantId, "dashboard");
      await cache.invalidateResource(msg.tenantId, "accounts");
      return;
    }

    if (raw.type === "asset_disposal") {
      const d = raw as {
        assetId: string; acquisitionCost: string; accumulatedDep: string;
        proceeds: string | number; gainLoss: string; currency?: string;
      };
      // M1: carry paise as decimal strings -> BigInt (no Number() on paise).
      const acq = BigInt(d.acquisitionCost);
      const accum = BigInt(d.accumulatedDep);
      const proceeds = BigInt(d.proceeds ?? 0);
      const gainLoss = BigInt(d.gainLoss);
      // C1: deterministic journal id keyed off the asset disposal so redelivery
      // hits the journal PK and no-ops (mirrors the GL spine).
      const journalId = deterministicId(`asset_disposal:${d.assetId}`);
      const today = new Date().toISOString().slice(0, 10);
      const lines: JournalLine[] = [
        { accountCode: ACCUM_DEP, debitMinor: accum.toString(), creditMinor: "0" },
        { accountCode: FIXED_ASSET, debitMinor: "0", creditMinor: acq.toString() },
      ];
      if (proceeds > 0n) {
        lines.push({ accountCode: CASH, debitMinor: proceeds.toString(), creditMinor: "0" });
      }
      if (gainLoss > 0n) {
        lines.push({ accountCode: GAIN_LOSS, debitMinor: "0", creditMinor: gainLoss.toString() });
      } else if (gainLoss < 0n) {
        lines.push({ accountCode: GAIN_LOSS, debitMinor: (-gainLoss).toString(), creditMinor: "0" });
      }
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await postJournal(tx, msg, {
          id: journalId,
          tenantId: msg.tenantId,
          voucherNo: `DISP/${today}/${String(d.assetId).slice(0, 8)}`,
          type: "asset_disposal",
          postingDate: today,
          lines,
        });
      });
      await cache.invalidate(cache.makeKey(msg.tenantId, "gl_trial_balance", msg.tenantId));
      // BUG FIX (review follow-up): see the matching comment above
      // (depreciation branch) -- gl_financial_statements needs invalidating
      // at every point gl_trial_balance already is.
      await cache.invalidate(cache.makeKey(msg.tenantId, "gl_financial_statements", msg.tenantId));
      // BUG FIX (Medium finding): see the matching comment above
      // (depreciation branch) -- dashboard/accounts need invalidating at
      // every point gl_trial_balance already is.
      await cache.invalidateResource(msg.tenantId, "dashboard");
      await cache.invalidateResource(msg.tenantId, "accounts");
      return;
    }

    const p = raw as StandardJournal;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await postJournal(tx, msg, p);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "gl_trial_balance", msg.tenantId));
    // BUG FIX (review follow-up): see the matching comment above
    // (depreciation branch) -- gl_financial_statements needs invalidating at
    // every point gl_trial_balance already is.
    await cache.invalidate(cache.makeKey(msg.tenantId, "gl_financial_statements", msg.tenantId));
    // BUG FIX (Medium finding): see the matching comment above
    // (depreciation branch) -- dashboard/accounts need invalidating at every
    // point gl_trial_balance already is.
    await cache.invalidateResource(msg.tenantId, "dashboard");
    await cache.invalidateResource(msg.tenantId, "accounts");
  });

  // DOM-024 R11 (maker-checker) — a MANUAL journal entry (POST
  // /v1/finance/journals, gl/commands.ts createJournal()) lands here as
  // `pending_approval`, NOT posted: no ledger lines, no budget/period
  // effect, no voucher number allocated yet (all of that only happens at
  // actual posting time — see finance.gl.approve below, and postJournal()'s
  // `existing` branch). created_by = this maker. Automated/system-generated
  // journals never publish this topic — they still call enqueueSpineJournal
  // (gl/spine.ts) straight to finance.gl.post above, unaffected.
  queue.subscribe(COMMANDS.journalCreate, async (msg) => {
    const p = msg.payload as StandardJournal;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      // Structural check repeated here (also re-checked by postJournal() at
      // actual posting time): cheap, pure, and guards against a stored draft
      // being tampered with between create and approve.
      assertJournalBalances(p.lines);
      // Same rationale, same defense-in-depth: reject a manually-created
      // zero-amount draft here too, not just at the HTTP layer
      // (validators.ts) — a checker must never be asked to approve a draft
      // with nothing to post. See assertJournalHasAmount()'s doc comment
      // (gl/domain.ts).
      assertJournalHasAmount(p.lines);
      // finance_journals has UNIQUE(tenant_id, voucher_no). The real gapless
      // number is only allocated at actual-posting time (approval) — see
      // postJournal()'s voucher-numbering block — so a still-pending draft
      // cannot store the literal "AUTO" sentinel verbatim: a SECOND pending
      // draft for the same tenant (the common case — most manual entries
      // don't set a custom voucher number) would collide on this exact
      // constraint before either was ever approved. `DRAFT-<id>` is unique
      // per row (journal.id is the primary key) and is itself recognised as
      // "needs allocation" by postJournal(), same as "AUTO".
      const rawVoucherNo = p.voucherNo;
      const needsAllocation = !rawVoucherNo || rawVoucherNo.trim() === "" || rawVoucherNo.toUpperCase() === "AUTO";
      const draftVoucherNo = needsAllocation ? `DRAFT-${p.id}` : rawVoucherNo;
      await repo.insertJournal(tx, {
        id: p.id, tenantId: p.tenantId, voucherNo: draftVoucherNo,
        type: p.type, postingDate: p.postingDate, lines: p.lines,
        status: "pending_approval", createdBy: msg.actorId, updatedBy: msg.actorId,
        budgetOverride: p.budgetOverride ?? false, overrideReason: p.overrideReason ?? null,
        ...(p.legalEntityId ? { legalEntityId: p.legalEntityId } : {}),
        ...(p.costCenterId ? { costCenterId: p.costCenterId } : {}),
        ...(p.profitCenterId ? { profitCenterId: p.profitCenterId } : {}),
        ...(p.operatingUnitId ? { operatingUnitId: p.operatingUnitId } : {}),
      });
      await enqueue(tx, {
        topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { service: "finance", action: "create_journal_draft", resourceType: "journal", resourceId: p.id, outcome: "success" },
      });
    });
    await cache.invalidateResource(msg.tenantId, "journals");
  });

  // DOM-024 R11 (maker-checker) — a checker (an officer other than the
  // maker; role-gated to finance_admin/super_admin in gl/routes.ts) approves
  // a pending manual journal entry, which actually posts it: this is the
  // ONLY place assertDistinctMakerChecker guards the base manual-posting
  // action (journalReverse already guards reversal the same way, lower in
  // this file). postJournal() detects the pre-existing pending_approval row
  // and UPDATEs it to posted in place instead of inserting again.
  queue.subscribe(COMMANDS.journalApprove, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const existing = await repo.findJournalByIdTx(tx, p.id);
      // H2-style: IDOR / not-found — throw to roll back markProcessed and
      // trigger retry/DLQ (mirrors budget/consumer.ts sanctionApprove).
      if (!existing || existing.tenantId !== p.tenantId) {
        throw new NonRetryableError(`[finance/gl] IDOR or not-found: id=${p.id} tenant=${p.tenantId}`);
      }
      if (existing.status === "posted") return; // true idempotent redelivery
      if (existing.status !== "pending_approval") {
        throw new NonRetryableError(`[finance/gl] INVALID_JOURNAL_STATE: id=${p.id} status=${existing.status}`);
      }
      // R11 SoD: the approving officer (checker) must differ from the
      // officer who drafted it (maker). Same-officer approval is exactly
      // the unattended-posting gap DOM-024 closes.
      assertDistinctMakerChecker(existing.createdBy, msg.actorId);
      const lines = (existing.lines ?? []) as JournalLine[];
      // CRITICAL fix (proven repro): a journal created with debitMinor:0 /
      // creditMinor:0 on every line passes the balance check trivially at
      // creation (0 === 0). Creation now rejects that up front —
      // assertJournalHasAmount() in validators.ts / gl/commands.ts
      // createJournal() / this file's finance.gl.create handler above — so
      // this branch should be structurally unreachable. It exists as a
      // defensive backstop: without it, a zero-total draft that somehow
      // still reached pending_approval would hit postJournal()'s own M2
      // zero-amount early-return (a deliberate silent no-op there, but only
      // correct for AUTOMATED postings with a genuine zero net movement —
      // see that function's comment) BEFORE postJournal() ever reaches the
      // code that flips status to "posted". The checker's approval would
      // then 202 and the journal would sit in pending_approval forever with
      // no visible failure anywhere. Fail loudly and non-retryably instead
      // — same pattern as the IDOR / INVALID_JOURNAL_STATE checks above —
      // so it shows up in the DLQ for an admin to investigate, rather than
      // silently doing nothing or minting a meaningless $0 voucher into an
      // append-only ledger.
      const totalDebit = lines.reduce((acc, l) => acc + BigInt(l.debitMinor), 0n);
      if (totalDebit === 0n) {
        throw new NonRetryableError(
          `[finance/gl] JOURNAL_ZERO_AMOUNT: id=${p.id} has a zero net amount and cannot be approved — reject or correct the draft instead`,
        );
      }
      await postJournal(tx, msg, {
        id: existing.id, tenantId: existing.tenantId, voucherNo: existing.voucherNo,
        type: existing.type, postingDate: existing.postingDate, lines,
        budgetOverride: existing.budgetOverride,
        ...(existing.overrideReason ? { overrideReason: existing.overrideReason } : {}),
        ...(existing.legalEntityId ? { legalEntityId: existing.legalEntityId } : {}),
        ...(existing.costCenterId ? { costCenterId: existing.costCenterId } : {}),
        ...(existing.profitCenterId ? { profitCenterId: existing.profitCenterId } : {}),
        ...(existing.operatingUnitId ? { operatingUnitId: existing.operatingUnitId } : {}),
      });
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "gl_trial_balance", msg.tenantId));
    // BUG FIX (review follow-up): see the matching comment above
    // (depreciation branch) -- gl_financial_statements needs invalidating at
    // every point gl_trial_balance already is.
    await cache.invalidate(cache.makeKey(msg.tenantId, "gl_financial_statements", msg.tenantId));
    // BUG FIX (Medium finding): see the matching comment above
    // (depreciation branch) -- dashboard/accounts need invalidating at every
    // point gl_trial_balance already is. This is the journal-APPROVE path
    // (the actual posting moment for a manual maker-checker entry) --
    // exactly the "post and approve a journal" scenario the live
    // sabotage-then-restore verification for this finding exercises.
    await cache.invalidateResource(msg.tenantId, "dashboard");
    await cache.invalidateResource(msg.tenantId, "accounts");
    await cache.invalidateResource(msg.tenantId, "journals");
  });

  /**
   * BL-03: payroll.run.disbursed → salary SETTLEMENT journal.
   * The accrual (Dr salary expense / Cr net payable / Cr statutory) posts on
   * payroll.run.approved via the integrations consumer; this handler clears the
   * net-payable liability against the bank when the run is actually disbursed:
   * Dr <net payable> / Cr <bank>. The previous subscription here consumed
   * "payroll.run.finalized" — a topic no service ever emitted — so this leg
   * never posted. Head codes are env-configurable and must exist in the
   * per-tenant Chart of Accounts (unknown codes emit finance.gl.rejected).
   */
  queue.subscribe(CONSUMED_EVENTS.payrollRunDisbursed, async (msg) => {
    const p = msg.payload as {
      runId: string;
      month: string;
      totalNetMinor: string;
      messageId?: string;
    };

    const PAYABLE_HEAD = process.env["PAYROLL_GL_NET_PAYABLE_HEAD"] ?? "2101";
    const BANK_HEAD = process.env["PAYROLL_GL_BANK_HEAD"] ?? "1101";

    // Deterministic id keyed off the run so an outbox redelivery hits the
    // journal PK and no-ops (mirrors the GL spine).
    const journalId = deterministicId(`payroll_settlement:${p.runId}`);
    const today = new Date().toISOString().slice(0, 10);
    // H3: paise as bigint — no Number() on aggregate paise.
    const net = BigInt(p.totalNetMinor);

    // A zero-net run has nothing to settle (all-exception slips); posting an
    // all-zero journal would be rejected downstream as unbalanced noise.
    if (net <= 0n) {
        await db.transaction(async (tx) => { await markProcessed(tx, msg.messageId); });
        return;
      }

      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;

        // Validate both head codes exist in COA for this tenant
        const resolvedLines: JournalLine[] = [];
        for (const entry of [
          { headCode: PAYABLE_HEAD, debitMinor: net.toString(), creditMinor: "0" },
          { headCode: BANK_HEAD, debitMinor: "0", creditMinor: net.toString() },
        ]) {
          const head = await budgetRepo.findHeadByCodeTx(
            tx as Parameters<typeof budgetRepo.findHeadByCodeTx>[0],
            msg.tenantId,
            entry.headCode,
          );
          if (!head) {
            await enqueue(tx, {
              topic: EVENTS.glRejected, eventType: EVENTS.glRejected,
              tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
              payload: { runId: p.runId, journalId, reason: `INVALID_HEAD_CODE: head code '${entry.headCode}' not found in Chart of Accounts for tenant ${msg.tenantId}` },
            });
            return;  // markProcessed + glRejected atomic
          }
          resolvedLines.push({
            accountCode: head.id,
            debitMinor: entry.debitMinor,
            creditMinor: entry.creditMinor,
          });
        }

        // Validate the journal is balanced (sum debits === sum credits)
        assertJournalBalances(resolvedLines);

        // Post journal via the standard postJournal path
        await postJournal(tx, msg, {
          id: journalId,
          tenantId: msg.tenantId,
          voucherNo: `PAYSTL/${p.month}/${p.runId.slice(0, 8).toUpperCase()}`,
          type: "payroll_settlement",
          postingDate: today,
          lines: resolvedLines,
        });
      });

      await cache.invalidateResource(msg.tenantId, "journals");
  });

  // P0-3: reversal = contra-as-creation. Post a NEW mirror journal (debits and
  // credits swapped) linked to the original via reverses_id, then mark the
  // original 'reversed' through the controlled status transition the DB trigger
  // permits (posted -> reversed). The original's lines/amounts are never mutated.
  queue.subscribe(COMMANDS.journalReverse, async (msg) => {
    const raw = msg.payload as { id: string; tenantId: string; originalJournalId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const original = await repo.findJournalByIdTx(tx, raw.originalJournalId);
      if (!original) throw new Error(`JOURNAL_NOT_FOUND: ${raw.originalJournalId}`);
      if (original.tenantId !== msg.tenantId) throw new Error(`JOURNAL_TENANT_MISMATCH: ${raw.originalJournalId}`);
      assertDistinctMakerChecker(original.createdBy, msg.actorId);
      if (original.status === "reversed") return; // already reversed — idempotent no-op
      if (original.status !== "posted") throw new Error(`JOURNAL_NOT_POSTED: cannot reverse status '${original.status}'`);
      const origLines = (original.lines ?? []) as JournalLine[];
      const mirrorLines: JournalLine[] = origLines.map((l) => ({
        accountCode: l.accountCode,
        // Serialise paise as decimal strings (jsonb cannot hold BigInt); the
        // posting path rebuilds them with BigInt(...). Swap Dr<->Cr.
        debitMinor: BigInt(l.creditMinor).toString(),
        creditMinor: BigInt(l.debitMinor).toString(),
        ...(l.narration ? { narration: `REVERSAL: ${l.narration}` } : {}),
      }));
      // Deterministic mirror id keyed off the original, so redelivery cannot
      // create two mirror journals.
      const mirrorId = raw.id;
      const today = new Date().toISOString().slice(0, 10);
      await postJournal(tx, msg, {
        id: mirrorId,
        tenantId: msg.tenantId,
        voucherNo: "AUTO",
        type: "contra",
        postingDate: today,
        lines: mirrorLines,
        reversesId: original.id,
      });
      await repo.markJournalReversed(tx, original.id, msg.actorId);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "gl_trial_balance", msg.tenantId));
    // BUG FIX (review follow-up): see the matching comment above
    // (depreciation branch) -- gl_financial_statements needs invalidating at
    // every point gl_trial_balance already is.
    await cache.invalidate(cache.makeKey(msg.tenantId, "gl_financial_statements", msg.tenantId));
    // BUG FIX (Medium finding): see the matching comment above
    // (depreciation branch) -- dashboard/accounts need invalidating at every
    // point gl_trial_balance already is.
    await cache.invalidateResource(msg.tenantId, "dashboard");
    await cache.invalidateResource(msg.tenantId, "accounts");
  });
}
