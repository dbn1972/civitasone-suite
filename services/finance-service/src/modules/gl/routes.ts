import { idempotentId } from "@civitasone/auth";
import { sendAccepted, sendValidated } from "@civitasone/schemas/validate";
import { acceptedResponseSchema, listQuerySchema } from "@civitasone/schemas/common";
import { GLEntrySummaryListSchema, FinancialStatementSummaryListSchema } from "@civitasone/schemas/web";
import type { FastifyInstance } from "fastify";
import { resolveContext, requireRole, HttpError, financeErrorHandler } from "../../shared/context.js";
import { findControlAccountRefs, findHeadByCodeTx } from "../budget/repo.js";
import { scopedRead } from "../../shared/db.js";
import { fetchUserNames } from "../../shared/identity-client.js";
import { idempotentCreate } from "../../shared/idempotency.js";
import { getPeriodStatusDb } from "../period-close/repo.js";
import { assertNoControlAccounts, DomainError } from "./domain.js";
import { periodPostingRefusal, voucherNeedsAllocation } from "./posting-rules.js";
import { postJournalBody, ledgerQueryParams, reverseParam, ledgerPageQuery, rejectJournalBody } from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";
import * as repo from "./repo.js";
import { assertProvisionHttp } from "../budget/provision.js";
import { assertFiscalYearActiveHttp } from "./fy-guard.js";

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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * UAT T-EDGE TE-07 (J16): a journal line naming an account code that is not in the chart of
 * accounts was accepted as a draft that could never post (the posting consumer refuses it as
 * UNKNOWN_ACCOUNT_CODE). Checked here with the same lookup, as a field error on that line.
 * A head UUID passes through, exactly as in the consumer.
 */
async function assertKnownAccountCodes(tenantId: string, lines: Array<{ accountCode: string }>): Promise<void> {
  const codes = [...new Set(lines.map((l) => l.accountCode).filter((c) => !UUID_RE.test(c)))];
  if (codes.length === 0) return;
  const found = await scopedRead(async (tx) => {
    const known = new Set<string>();
    for (const code of codes) if (await findHeadByCodeTx(tx as Parameters<typeof findHeadByCodeTx>[0], tenantId, code)) known.add(code);
    return known;
  });
  const fieldErrors = lines.flatMap((l, i) => (UUID_RE.test(l.accountCode) || found.has(l.accountCode)
    ? []
    : [{ field: `lines.${i}.accountCode`, message: "This account code is not in the chart of accounts.", code: "UNKNOWN_ACCOUNT_CODE" }]));
  if (fieldErrors.length > 0) throw new HttpError(422, "UNKNOWN_ACCOUNT_CODE", "one or more account codes are not in the chart of accounts", fieldErrors);
}

/**
 * UAT T-EDGE TE-08: the losing checker of a parallel approval was told 202 "accepted". A journal
 * that is already posted (decided) is now a synchronous 409 TASK_ALREADY_DECIDED naming who
 * decided it. Name lookup fails open to null (the web then says "another officer").
 */
async function alreadyDecided(tenantId: string, journal: { status: string; updatedBy: string | null; updatedAt?: Date | string | null }): Promise<HttpError> {
  const names = journal.updatedBy ? await fetchUserNames(tenantId, [journal.updatedBy]) : new Map<string, string>();
  const decidedByName = journal.updatedBy ? names.get(journal.updatedBy) ?? null : null;
  return new HttpError(409, "TASK_ALREADY_DECIDED", `this journal was already decided (${journal.status})${decidedByName ? ` by ${decidedByName}` : ""}`, undefined, {
    decision: journal.status,
    decidedBy: journal.updatedBy ? { id: journal.updatedBy, name: decidedByName } : null,
    decidedAt: journal.updatedAt ? new Date(journal.updatedAt).toISOString() : null,
  });
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
    // UAT T-PERIOD D-07 / D-03: not into a financial year that is not active yet, and no debit to an expenditure head
    // without a budget provision for the year (GFR). The posting consumer re-checks both at posting time.
    await assertFiscalYearActiveHttp(ctx.tenantId, body.postingDate);
    await assertProvisionHttp(ctx.tenantId, body.lines.filter((l) => BigInt(l.debitMinor) > 0n).map((l) => String(l.accountCode)), body.postingDate, body.type, "lines");
    // GAP-FINANCE-ACCOUNTING-VOUCHERS-NEW-05 / GAP-FINANCE-JOURNAL-ENTRY-06 (same check, built by two clusters; one kept): a typed voucher number must be unique per tenant. The UNIQUE(tenant_id,
    // voucher_no) index stays the authority for a true race (the consumer would dead-letter the loser), but a plain
    // duplicate is answered here, as a field error on voucherNo, instead of a 202 followed by a silently dropped
    // draft. A retry of THIS request (same idempotency key -> same journal id) is not a duplicate of itself.
    if (!voucherNeedsAllocation(body.voucherNo)) {
      const taken = await repo.findJournalByVoucherNo(ctx.tenantId, body.voucherNo);
      if (taken && taken.id !== idempotentId(ctx)) {
        throw new HttpError(409, "DUPLICATE_VOUCHER", "voucher number already exists", [
          { field: "voucherNo", message: "This voucher number already exists. Enter a different number, or leave it blank to auto-number." },
        ]);
      }
    }
    await assertKnownAccountCodes(ctx.tenantId, body.lines);
    // DOM-024: this now creates a pending_approval draft, not a posted
    // journal — see gl/commands.ts createJournal() / gl/consumer.ts
    // finance.gl.create.
    // UAT T-EDGE TE-09: one journal per X-Idempotency-Key (same body replays the first 202,
    // another body is a 422). The checks above are replay-safe (the duplicate-voucher check
    // already skips this request own journal id), so only the publish is wrapped.
    return sendAccepted(reply, acceptedResponseSchema, await idempotentCreate(ctx, "finance.journal.create", body, () => commands.createJournal(ctx, body)));
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
    // UAT W8-D (P1): a journal this tenant does not have can never be approved: 404, not 202.
    if (!draft || draft.tenantId !== ctx.tenantId) throw new HttpError(404, "NOT_FOUND", "journal not found");
    // UAT P2 (J6): a rejected journal is final; approving it can never succeed, so say so now (not a 202 + DLQ).
    if (draft.status === "rejected") {
      throw new HttpError(409, "JOURNAL_REJECTED", "this journal was rejected and cannot be approved; raise a new voucher");
    }
    // UAT T-EDGE TE-08: already posted by another checker -> 409 with who decided, not 202.
    if (draft.status === "posted" || draft.status === "reversed") throw await alreadyDecided(ctx.tenantId, draft);
    // F107: the maker approving their own draft is refused now (403), not 202-accepted and dead-lettered later in the
    // queue. The consumer keeps its own check (assertDistinctMakerChecker) for anything that reaches it another way.
    if (draft.status === "pending_approval" && draft.createdBy === ctx.actorId) {
      throw new HttpError(403, "MAKER_CHECKER_VIOLATION", "you drafted this journal; a different officer must approve or reject it");
    }
    if (draft.status === "pending_approval") {
      await assertPeriodAcceptsPosting(ctx.tenantId, String(draft.postingDate), draft.type);
      await assertFiscalYearActiveHttp(ctx.tenantId, String(draft.postingDate));
      const draftLines = (Array.isArray(draft.lines) ? draft.lines : []) as Array<{ accountCode: string; debitMinor: string | number }>;
      await assertProvisionHttp(ctx.tenantId, draftLines.filter((l) => BigInt(l.debitMinor ?? 0) > 0n).map((l) => String(l.accountCode)), String(draft.postingDate), draft.type, "lines");
    }
    return sendAccepted(reply, acceptedResponseSchema, await commands.approveJournal(ctx, id));
  });

  // UAT P2 (J6) — a checker rejects a pending manual journal. Final (owner decision): nothing posts, the journal is
  // kept read-only as 'rejected' with the reason, and the maker raises a fresh voucher. Same role tier as approval;
  // the maker cannot reject their own draft (refused here, and again in the consumer transaction).
  app.patch("/v1/finance/journals/:id/reject", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, JOURNAL_APPROVE_ROLES);
    const { id } = reverseParam.parse(req.params);
    const body = rejectJournalBody.parse(req.body);
    const draft = await repo.findJournalById(id);
    if (!draft || draft.tenantId !== ctx.tenantId) throw new HttpError(404, "NOT_FOUND", "journal not found");
    if (draft.status !== "pending_approval") {
      throw new HttpError(409, "JOURNAL_NOT_PENDING", `only a journal waiting for approval can be rejected (this one is ${draft.status})`);
    }
    if (draft.createdBy === ctx.actorId) {
      throw new HttpError(403, "MAKER_CHECKER_VIOLATION", "you drafted this journal; a different officer must approve or reject it");
    }
    return sendAccepted(reply, acceptedResponseSchema, await commands.rejectJournal(ctx, id, body.reason));
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
    // UAT W8-D (P1): tenant-scoped existence read; the consumer stays the race-safe state check.
    const journal = await repo.findJournalById(id);
    if (!journal || journal.tenantId !== ctx.tenantId) throw new HttpError(404, "NOT_FOUND", "journal not found");
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

  // UAT P2 (J6, D4): the checker's queue -- manual journals awaiting approval, with their lines and narration.
  // Readable by every finance reader; only JOURNAL_APPROVE_ROLES can act on them (PATCH .../:id/approve).
  app.get("/v1/finance/journals/pending", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = listQuerySchema.parse(req.query);
    const rows = await queries.listPendingJournals(ctx.tenantId, ctx.actorId, q.limit, q.offset);
    return reply.send({ data: rows, pagination: { hasMore: rows.length === q.limit, pageSize: q.limit } });
  });

  // UAT P2 (J6): rejected manual journals, read-only, for the audit trail and so the maker sees why.
  app.get("/v1/finance/journals/rejected", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = listQuerySchema.parse(req.query);
    const rows = await queries.listRejectedJournals(ctx.tenantId, ctx.actorId, q.limit, q.offset);
    return reply.send({ data: rows, pagination: { hasMore: rows.length === q.limit, pageSize: q.limit } });
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
