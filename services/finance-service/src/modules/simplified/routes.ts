/**
 * Simplified (MSME) accounting routes.
 *
 * Available ONLY for tenants with edition = 'small_office' (MSME).
 * Routes return user-friendly data: "Income ₹50,000", "Expense ₹12,000", etc.
 * No GL jargon: no "Dr", "Cr", "Journal", "Ledger", "Head of Account".
 */
import type { FastifyInstance } from "fastify";
import { resolveContext, requireRole, HttpError, financeErrorHandler } from "../../shared/context.js";
import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import {
  recordIncomeBody,
  recordExpenseBody,
  recordPaymentReceivedBody,
  recordPaymentMadeBody,
  summaryQuery,
  listQuery,
} from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";

/** Roles allowed to use simplified finance. */
const SIMPLIFIED_ROLES = ["finance_officer", "finance_admin", "super_admin", "small_office_admin", "owner"];
const READER_ROLES = [...SIMPLIFIED_ROLES, "accountant", "viewer"];

/**
 * Edition guard — only small_office / MSME tenants may access these routes.
 * In production, the tenant edition is resolved from the JWT claims or a
 * tenant-service lookup. For now, we check the x-tenant-edition header or
 * allow all (controlled by env flag).
 */
function requireMsmeEdition(req: { headers: Record<string, string | string[] | undefined> }): void {
  const edition = req.headers["x-tenant-edition"] as string | undefined;
  // If the header is set and it's NOT a small-office variant, block.
  if (!edition || !["small_office", "msme", "startup"].includes(edition)) {
    throw new HttpError(403, "EDITION_RESTRICTED", "Simplified accounting is only available for Small Office / MSME tenants");
  }
}

export async function simplifiedRoutes(app: FastifyInstance): Promise<void> {
  // ──────────── READ ROUTES (Reports) ────────────

  app.get("/v1/finance/simplified/summary", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    requireMsmeEdition(req);
    const q = summaryQuery.parse(req.query);
    const summary = await queries.getSummary(ctx.tenantId, q.period);
    return reply.send(summary);
  });

  app.get("/v1/finance/simplified/income", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    requireMsmeEdition(req);
    const q = listQuery.parse(req.query);
    const data = await queries.getIncomeList(ctx.tenantId, q);
    return reply.send({ data, pagination: { hasMore: data.length === q.limit, pageSize: q.limit } });
  });

  app.get("/v1/finance/simplified/expenses", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    requireMsmeEdition(req);
    const q = listQuery.parse(req.query);
    const data = await queries.getExpenseList(ctx.tenantId, q);
    return reply.send({ data, pagination: { hasMore: data.length === q.limit, pageSize: q.limit } });
  });

  app.get("/v1/finance/simplified/cashflow", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    requireMsmeEdition(req);
    const q = listQuery.parse(req.query);
    const data = await queries.getCashflow(ctx.tenantId, { from: q.from, to: q.to });
    return reply.send({ data });
  });

  // ──────────── WRITE ROUTES (Commands) ────────────

  app.post("/v1/finance/simplified/record-income", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, SIMPLIFIED_ROLES);
    requireMsmeEdition(req);
    const body = recordIncomeBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.recordIncome(ctx, body));
  });

  app.post("/v1/finance/simplified/record-expense", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, SIMPLIFIED_ROLES);
    requireMsmeEdition(req);
    const body = recordExpenseBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.recordExpense(ctx, body));
  });

  app.post("/v1/finance/simplified/record-payment-received", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, SIMPLIFIED_ROLES);
    requireMsmeEdition(req);
    const body = recordPaymentReceivedBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.recordPaymentReceived(ctx, body));
  });

  app.post("/v1/finance/simplified/record-payment-made", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, SIMPLIFIED_ROLES);
    requireMsmeEdition(req);
    const body = recordPaymentMadeBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.recordPaymentMade(ctx, body));
  });

  app.setErrorHandler(financeErrorHandler);
}
