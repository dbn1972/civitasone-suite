import { sendAccepted, sendValidated } from "@civitasone/schemas/validate";
import { acceptedResponseSchema, listQuerySchema } from "@civitasone/schemas/common";
import {
  FinanceDebtSummaryListSchema, FinanceGuaranteeSummaryListSchema,
  FinanceChallanSummaryListSchema, FinanceChallanSummarySchema,
  FinanceDepositSummaryListSchema, FinanceDepositsSummarySchema,
} from "@civitasone/schemas/web";
import type { FastifyInstance } from "fastify";
import { resolveContext, requireRole, HttpError, financeErrorHandler } from "../../shared/context.js";
import { createChallanBody, createDepositBody, depositDispositionBody, idParam } from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";
import * as repo from "./repo.js";
import { challanView } from "./challan-view.js";

const FINANCE_ROLES = ["finance_officer", "finance_admin", "super_admin"];
const READER_ROLES  = [...FINANCE_ROLES, "audit_officer"];

export async function treasuryRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/finance/challans", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);
    const body = createChallanBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createChallan(ctx, body));
  });

  app.get("/v1/finance/banks/:id/balance", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);
    const { id } = idParam.parse(req.params);
    const bank = await queries.getBankBalance(id, ctx.tenantId);
    if (!bank || bank.tenantId !== ctx.tenantId) throw new HttpError(404, "NOT_FOUND", "bank account not found");
    return reply.send({
      id: bank.id,
      name: bank.name,
      accountNoLast4: String(bank.accountNo).slice(-4),
      balanceMinor: bank.balanceMinor.toString(),
      currency: bank.currency,
    });
  });

  // finance_debt table + FinanceDebtSummarySchema both already existed; this
  // route was simply never registered, so the debt register page 404'd live.
  app.get("/v1/finance/debt", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = listQuerySchema.parse(req.query);
    const rows = await repo.listDebtByTenant(ctx.tenantId, q.limit, q.offset);
    sendValidated(reply, FinanceDebtSummaryListSchema, rows.map((r) => ({
      id: r.id, instrument: r.instrument, source: r.source,
      amountMinor: r.amountMinor.toString(), currency: r.currency,
      maturity: r.maturity, status: r.status,
      lender: r.lender, interestRateBps: r.interestRateBps, tenureMonths: r.tenureMonths,
      outstandingMinor: r.outstandingMinor == null ? null : r.outstandingMinor.toString(),
      createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(), version: r.version,
    })));
  });

  // finance_guarantees table + FinanceGuaranteeSummarySchema both already
  // existed; no route anywhere ever exposed them.
  app.get("/v1/finance/guarantees", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = listQuerySchema.parse(req.query);
    const rows = await repo.listGuaranteesByTenant(ctx.tenantId, q.limit, q.offset);
    sendValidated(reply, FinanceGuaranteeSummaryListSchema, rows.map((r) => ({
      id: r.id, entity: r.entity, type: r.type,
      amountMinor: r.amountMinor.toString(), currency: r.currency,
      feePct: String(r.feePct), status: r.status,
      validUntil: r.validUntil, beneficiary: r.beneficiary, linkedRef: r.linkedRef,
      createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(), version: r.version,
    })));
  });

  // The register page needs both list and detail; challans was POST-only
  // (issuance), so both GETs were missing.
  app.get("/v1/finance/challans", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = listQuerySchema.parse(req.query);
    const rows = await repo.listChallansByTenant(ctx.tenantId, q.limit, q.offset);
    sendValidated(reply, FinanceChallanSummaryListSchema, rows.map(challanView));
  });

  app.get("/v1/finance/challans/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = idParam.parse(req.params);
    const r = await repo.findChallanByIdAndTenant(id, ctx.tenantId);
    if (!r) throw new HttpError(404, "NOT_FOUND", "challan not found");
    sendValidated(reply, FinanceChallanSummarySchema, challanView(r));
  });

  // Deposits was also POST-only (pd/emd/sd/fdr issuance); the register page
  // needs a list.
  app.get("/v1/finance/deposits", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = listQuerySchema.parse(req.query);
    const rows = await repo.listDepositsByTenant(ctx.tenantId, q.limit, q.offset);
    sendValidated(reply, FinanceDepositSummaryListSchema, rows.map((r) => ({
      id: r.id, pdNo: r.pdNo, type: r.type, administrator: r.administrator,
      balanceMinor: r.balanceMinor.toString(), currency: r.currency, status: r.status,
      createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(), version: r.version,
    })));
  });

  // GAP2-FINANCE-TREASURY-DEPOSITS-TOTALS-06: tenant-wide totals for the register
  // stat cards (counts + active balance), aggregated server-side so they never
  // reflect only the 50-row default page.
  app.get("/v1/finance/deposits/summary", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    sendValidated(reply, FinanceDepositsSummarySchema, await queries.getDepositsSummary(ctx.tenantId));
  });

  // GAP-FINANCE-TREASURY-DEPOSITS-03: one deposit with its ledger of events.
  app.get("/v1/finance/deposits/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = idParam.parse(req.params);
    const r = await repo.findDepositByIdAndTenant(id, ctx.tenantId);
    if (!r) throw new HttpError(404, "NOT_FOUND", "deposit not found");
    const events = await repo.listDepositEvents(ctx.tenantId, id);
    return reply.send({
      data: {
        id: r.id, pdNo: r.pdNo, type: r.type, administrator: r.administrator,
        balanceMinor: r.balanceMinor.toString(), currency: r.currency, status: r.status,
        sourceBillId: r.sourceBillId,
        refundedMinor: r.refundedMinor.toString(), forfeitedMinor: r.forfeitedMinor.toString(), adjustedMinor: r.adjustedMinor.toString(),
        createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(), version: r.version,
        events: events.map((e) => ({
          id: e.id, eventType: e.eventType, amountMinor: e.amountMinor.toString(),
          reference: e.reference, journalId: e.journalId, createdAt: e.createdAt.toISOString(),
        })),
      },
    });
  });

  app.post("/v1/finance/deposits", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);
    const body = createDepositBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createDeposit(ctx, body));
  });

  // P1-3: deposit lifecycle — refund / forfeit / adjust-against-bill.
  app.post("/v1/finance/deposits/:id/refund", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);
    const { id } = idParam.parse(req.params);
    const body = depositDispositionBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.refundDeposit(ctx, id, body));
  });

  app.post("/v1/finance/deposits/:id/forfeit", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);
    const { id } = idParam.parse(req.params);
    const body = depositDispositionBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.forfeitDeposit(ctx, id, body));
  });

  app.post("/v1/finance/deposits/:id/adjust", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);
    const { id } = idParam.parse(req.params);
    const body = depositDispositionBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.adjustDeposit(ctx, id, body));
  });

  app.setErrorHandler(financeErrorHandler);
}
