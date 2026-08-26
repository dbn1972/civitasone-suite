import { sendAccepted, sendValidated } from "@civitasone/schemas/validate";
import { acceptedResponseSchema, listQuerySchema } from "@civitasone/schemas/common";
import {
  FinanceDebtSummaryListSchema, FinanceGuaranteeSummaryListSchema,
  FinanceChallanSummaryListSchema, FinanceChallanSummarySchema,
  FinanceDepositSummaryListSchema,
} from "@civitasone/schemas/web";
import type { FastifyInstance } from "fastify";
import { resolveContext, requireRole, HttpError, financeErrorHandler } from "../../shared/context.js";
import { createChallanBody, createDepositBody, depositDispositionBody, idParam } from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";
import * as repo from "./repo.js";

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
    sendValidated(reply, FinanceChallanSummaryListSchema, rows.map((r) => ({
      id: r.id, challanNo: r.challanNo, receiptHeadId: r.receiptHeadId,
      depositor: r.depositor, amountMinor: r.amountMinor.toString(), currency: r.currency,
      grnNo: r.grnNo, status: r.status,
      createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(), version: r.version,
    })));
  });

  app.get("/v1/finance/challans/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = idParam.parse(req.params);
    const r = await repo.findChallanByIdAndTenant(id, ctx.tenantId);
    if (!r) throw new HttpError(404, "NOT_FOUND", "challan not found");
    sendValidated(reply, FinanceChallanSummarySchema, {
      id: r.id, challanNo: r.challanNo, receiptHeadId: r.receiptHeadId,
      depositor: r.depositor, amountMinor: r.amountMinor.toString(), currency: r.currency,
      grnNo: r.grnNo, status: r.status,
      createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(), version: r.version,
    });
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
