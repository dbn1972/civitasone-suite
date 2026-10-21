import { sendAccepted, sendValidated } from "@civitasone/schemas/validate";
import { acceptedResponseSchema, listQuerySchema } from "@civitasone/schemas/common";
import { GLEntrySummaryListSchema, FinancialStatementSummaryListSchema } from "@civitasone/schemas/web";
import type { FastifyInstance } from "fastify";
import { idempotentId } from "@civitasone/auth";
import { resolveContext, requireRole, HttpError, financeErrorHandler } from "../../shared/context.js";
import { findControlAccountRefs } from "../budget/repo.js";
import { getPeriodStatusDb } from "../period-close/repo.js";
import { assertNoControlAccounts, DomainError, periodPostingRefusal, voucherNeedsAllocation } from "./domain.js";
import { postJournalBody, ledgerQueryParams, reverseParam, ledgerPageQuery } from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";
import * as repo from "./repo.js";

const FINANCE_ROLES = ["finance_officer", "finance_admin", "super_admin"];
const READER_ROLES  = [...FINANCE_ROLES, "audit_officer"];
// DOM-007: posting over a head's budget requires an elevated role, same
// tier as period-close's hard-close "reopen" — the other GL-core control
// this codebase already lets an admin bypass, audited, with a reason.
const BUDGET_OVERRIDE_ROLES = ["finance_admin", "super_admin"];
// DOM-024 (maker-checker) — same elevated tier sanctions' R11 approve uses
// (budget/routes.ts). A plain finance_officer cannot approve/post a journal
// at all, even their own; the identity check (approver ≠ creator) is
// enforced separately, in the consumer transaction, for the case where the
// same elevated officer tries to approve their own draft.
const JOURNAL_APPROVE_ROLES = ["finance_admin", "super_admin"];

/** Plain-language text for the posting-date field when a period refuses the journal. */
const PERIOD_FIELD_MESSAGE = {
  PERIOD_CLOSED: "This accounting period is closed. Choose a posting date in an open period.",
  PERIOD_SOFT_CLOSED: "This period is soft-closed and accepts only adjustment or closing entries. Choose a posting date in an open period.",
  PERIOD_UNKNOWN: "Enter a valid posting date.",
} as const;

/**
 * GAP-FINANCE-ACCOUNTING-VOUCHERS-NEW-06: refuse a journal dated in a period that cannot take it NOW, with a 422 the
 * caller can act on, instead of 202-accepting a draft that can never post. The posting consumer (gl/consumer.ts
 * postJournal) stays the authority at posting time and applies the very same rule (periodPostingRefusal), so a period
 * that closes between this check and the post still posts nothing; this only moves the answer to the front.
 */
async function assertPeriodAcceptsPosting(tenantId: string, postingDate: string, journalType: string): Promise<void> {
  const period = postingDate.slice(0, 7);
  const refusal = periodPostingRefusal(await getPeriodStatusDb(tenantId, period), journalType, period);
  if (refusal) {
    throw new HttpError(422, refusal.code, refusal.message, [{ field: "postingDate", message: PERIOD_FIELD_MESSAGE[refusal.code] }]);
  }
}

export async function glRoutes(app: FastifyInstance): Promise<void> {
  // NOTE (flagged for explicit review): this was FINANCE_ROLES (includes
  // finance_officer) until commit 1bf09e5c ("API validation — bigint
  // monetary types, error handlers, pagination offset, period YYYY-MM")
  // silently narrowed it to FINANCE_ADMIN_ROLES as a side effect of an
  // unrelated diff — the commit message never mentions a role/permission
  // change. Every sibling finance-officer-facing endpoint in this file
  // (reverse, ledger, journals list, trial balance) still uses
  // FINANCE_ROLES, so a normal finance officer could see the GL and the
  // journal-entry form but got a 403 on the one action the page exists for.
  // Restored to match; if finance_officer posting journals unattended was in
  // fact an intentional tightening, re-narrow this deliberately instead.
  app.post("/v1/finance/journals", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);
    const body = postJournalBody.parse(req.body);
    // DOM-007: a plain finance_officer cannot self-authorize posting over
    // budget — only an elevated role can set budgetOverride, checked here
    // (before the command is even enqueued) so the override on the consumer
    // side (gl/consumer.ts) can trust the flag without re-deriving roles
    // from a queue message.
    if (body.budgetOverride) {
      requireRole(ctx, BUDGET_OVERRIDE_ROLES);
    }
    // GAP-FINANCE-JOURNAL-ENTRY-04: a manual journal may not post to a
    // sub-ledger control account. Checked synchronously so the officer sees the
    // refusal instead of a silently-dropped async draft.
    try {
      assertNoControlAccounts(await findControlAccountRefs(ctx.tenantId, body.lines.map((l) => l.accountCode)));
    } catch (err) {
      if (err instanceof DomainError) throw new HttpError(400, err.code, err.message);
      throw err;
    }
    // GAP-FINANCE-ACCOUNTING-VOUCHERS-NEW-06: a posting date in a closed period is a 422 here, not a draft that can
    // never be approved.
    await assertPeriodAcceptsPosting(ctx.tenantId, body.postingDate, body.type);
    // GAP-FINANCE-ACCOUNTING-VOUCHERS-NEW-05: a typed voucher number must be unique per tenant. The UNIQUE(tenant_id,
    // voucher_no) index stays the authority for a true race (the consumer would dead-letter the loser), but a plain
    // duplicate is answered here, as a field error on voucherNo, instead of a 202 followed by a silently dropped
    // draft. A retry of THIS request (same idempotency key -> same journal id) is not a duplicate of itself.
    if (!voucherNeedsAllocation(body.voucherNo)) {
      const taken = await repo.findJournalByVoucherNo(ctx.tenantId, body.voucherNo);
      if (taken && taken.id !== idempotentId(ctx)) {
        throw new HttpError(409, "DUPLICATE_VOUCHER_NO", "voucher number already exists", [
          { field: "voucherNo", message: "This voucher number already exists. Enter a different number, or leave it blank to auto-number." },
        ]);
      }
    }
    // DOM-024: this now creates a pending_approval draft, not a posted
    // journal — see gl/commands.ts createJournal() / gl/consumer.ts
    // finance.gl.create.
    return sendAccepted(reply, acceptedResponseSchema, await commands.createJournal(ctx, body));
  });

  // DOM-024 R11 (maker-checker) — a checker approves/posts a pending manual
  // journal entry. Restricted to finance_admin/super_admin; the SoD guard
  // (approver ≠ creator) is enforced in the consumer transaction
  // (gl/consumer.ts finance.gl.approve, assertDistinctMakerChecker). Reuses
  // reverseParam — both routes take only a UUID :id.
  app.patch("/v1/finance/journals/:id/approve", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, JOURNAL_APPROVE_ROLES);
    const { id } = reverseParam.parse(req.params);
    // GAP-FINANCE-ACCOUNTING-VOUCHERS-NEW-06: the period may have been closed since the maker drafted this. Tell the
    // checker now (422) rather than 202-accepting an approval the posting consumer would refuse. Only a draft of THIS
    // tenant that is still awaiting approval is checked here; anything else falls through to the consumer unchanged.
    const draft = await repo.findJournalById(id);
    if (draft && draft.tenantId === ctx.tenantId && draft.status === "pending_approval") {
      await assertPeriodAcceptsPosting(ctx.tenantId, String(draft.postingDate), draft.type);
    }
    return sendAccepted(reply, acceptedResponseSchema, await commands.approveJournal(ctx, id));
  });

  // POLICY DECISION (flagged for explicit review, not assumed obviously
  // correct): previously FINANCE_ROLES (baseline finance_officer + the SoD
  // "not the original creator" check in the consumer) while approving a
  // journal already required the elevated JOURNAL_APPROVE_ROLES tier —
  // reversal is at least as consequential as approval (it un-posts a
  // finalized entry and posts a mirror contra journal) and arguably more so,
  // so we tie it to the SAME elevated tier here. If a plain finance_officer
  // being able to reverse their own team's postings unattended was in fact
  // intentional, re-loosen this deliberately instead of by omission.
  app.post("/v1/finance/journals/:id/reverse", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, JOURNAL_APPROVE_ROLES);
    const { id } = reverseParam.parse(req.params);
    return sendAccepted(reply, acceptedResponseSchema, await commands.reverseJournal(ctx, id));
  });

  app.get("/v1/finance/ledger", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const params = ledgerQueryParams.parse(req.query);
    const lines = await queries.getLedger(ctx.tenantId, params);
    return reply.send({ data: lines, pagination: { hasMore: lines.length === params.limit, pageSize: params.limit } });
  });

  app.get("/v1/finance/journals", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = listQuerySchema.parse(req.query);
    sendValidated(reply, GLEntrySummaryListSchema, await queries.listJournalEntries(ctx.tenantId, q.limit, q.offset));
  });

  // GAP-FINANCE-ACCOUNTING-GENERAL-LEDGER-03: bounded, filtered ledger LINES with whole-set totals.
  app.get("/v1/finance/journals/lines", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = ledgerPageQuery.parse(req.query);
    return reply.send(await queries.pageGeneralLedger(ctx.tenantId, q));
  });

  app.get("/v1/finance/statements/trial-balance", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const rows = await queries.getTrialBalance(ctx.tenantId);
    return reply.send({ data: rows });
  });

  app.get("/v1/finance/statements/trial-balance/balanced", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = req.query as { period?: string };
    const period = typeof q.period === "string" && /^\d{4}-\d{2}$/.test(q.period) ? q.period : undefined;
    const result = await queries.getTrialBalanceBalanced(ctx.tenantId, period);
    return reply.send(result);
  });

  app.get("/v1/finance/statements", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    sendValidated(reply, FinancialStatementSummaryListSchema, await queries.listFinancialStatements(ctx.tenantId));
  });

  app.setErrorHandler(financeErrorHandler);
}
