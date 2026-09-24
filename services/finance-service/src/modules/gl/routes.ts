import { sendAccepted, sendValidated } from "@civitasone/schemas/validate";
import { acceptedResponseSchema, listQuerySchema } from "@civitasone/schemas/common";
import { GLEntrySummaryListSchema, FinancialStatementSummaryListSchema } from "@civitasone/schemas/web";
import type { FastifyInstance } from "fastify";
import { resolveContext, requireRole, financeErrorHandler } from "../../shared/context.js";
import { postJournalBody, ledgerQueryParams, reverseParam } from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";

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
