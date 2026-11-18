/**
 * Section 8 NF-7: fund-wise statutory statements (nonprofit / ICAI Schedule III shape). ADDITIVE routes under
 * /v1/finance/statements/fund-wise/...; the govt / commercial statement routes in routes.ts are not touched, so their output is
 * byte-identical by construction. Every fund-wise route answers 404 FUNDS_NOT_ENABLED unless gl.finance_settings.fund_accounting is ON
 * for the tenant (the same stored flag as /v1/finance/funds), so a govt tenant sees no fund-wise statements at all.
 *
 *  GET /v1/finance/statements/fund-wise/balance-sheet?fy=&comparatives=   per fund, per fund type, all funds (+ prior-year total)
 *  GET /v1/finance/statements/fund-wise/income-expenditure?fy=&comparatives=
 *  GET /v1/finance/statements/fund-wise/receipts-payments?fy=              from the fund-tagged cash book (supplementary format)
 *  GET /v1/finance/statements/fund-wise/utilisation-certificates?fy=       grant UC schedule; UC form / interest treatment pluggable
 *  GET /v1/finance/statements/set-for-tenant                               which statement set the tenant uses (resolver)
 *  GET /v1/finance/statements/fund-wise/set?fy=                            the whole set in one read (one snapshot)
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError, financeErrorHandler } from "../../shared/context.js";
import { scopedRead } from "../../shared/db.js";
import { currentFyIST, previousFy } from "../../shared/ist-date.js";
import { DomainError } from "../masters/domain.js";
import { loadPostingSettingsTx } from "../approvals/posting-settings.js";
import type { Tx } from "../year-end/repo.js";
import {
  fundWiseBalanceSheet, fundWiseIncomeExpenditure, fundWiseReceiptsPayments, renderUcLines, ucRenderConfig,
  type BalanceSheet, type IncomeExpenditure,
} from "./fund-statements.js";
import { loadCashRows, loadCoaTemplate, loadFunds, loadStatementInput, loadUcFacts, statementCodes } from "./fund-statements-repo.js";
import { statementSetFor } from "./statement-set.js";
import { loadStatementSettings } from "./commercial-statements-repo.js";

const READER_ROLES = ["finance_officer", "finance_admin", "super_admin", "audit_officer"];
const query = z.object({
  fy: z.string().regex(/^\d{4}-\d{2}$/, "fy must be a financial year such as 2026-27").optional(),
  comparatives: z.enum(["true", "false"]).default("true"),
});

async function requireEnabled(tx: Tx, tenantId: string): Promise<void> {
  const ps = await loadPostingSettingsTx(tx, tenantId);
  if (!ps.fundAccounting) throw new HttpError(404, "FUNDS_NOT_ENABLED", "fund accounting is not enabled for this tenant");
  // the resolver (statement-set.ts): fund-wise statements belong to the nonprofit set only
  if (statementSetFor(await loadCoaTemplate(tx, tenantId)).id !== "nonprofit") throw new HttpError(404, "STATEMENT_SET_NOT_AVAILABLE", "the fund-wise statement set is not available for this chart template");
}

const guard = async <T>(run: () => Promise<T>): Promise<T> => {
  try { return await run(); } catch (err) {
    if (err instanceof DomainError) throw new HttpError(409, err.code, err.message.replace(/^\[[A-Z_]+\]\s*/, ""));
    throw err;
  }
};

async function balanceSheetFor(tx: Tx, tenantId: string, fy: string, comparatives: boolean) {
  const current = fundWiseBalanceSheet(await loadStatementInput(tx, tenantId, fy));
  const prior = comparatives ? previousFy(fy) : null;
  const comparative: { fiscalYear: string; total: BalanceSheet } | null = prior ? { fiscalYear: prior, total: fundWiseBalanceSheet(await loadStatementInput(tx, tenantId, prior)).total } : null;
  return { fiscalYear: fy, ...current, comparative };
}

async function incomeExpenditureFor(tx: Tx, tenantId: string, fy: string, comparatives: boolean) {
  const current = fundWiseIncomeExpenditure(await loadStatementInput(tx, tenantId, fy));
  const prior = comparatives ? previousFy(fy) : null;
  const comparative: { fiscalYear: string; total: IncomeExpenditure } | null = prior ? { fiscalYear: prior, total: fundWiseIncomeExpenditure(await loadStatementInput(tx, tenantId, prior)).total } : null;
  return { fiscalYear: fy, ...current, comparative };
}

async function receiptsPaymentsFor(tx: Tx, tenantId: string, fy: string) {
  const [funds, rows] = await Promise.all([loadFunds(tx, tenantId), loadCashRows(tx, tenantId, fy)]);
  return { fiscalYear: fy, ...fundWiseReceiptsPayments(funds, rows, statementCodes()) };
}

async function utilisationFor(tx: Tx, tenantId: string, fy: string) {
  const lines = renderUcLines(await loadUcFacts(tx, tenantId, fy), ucRenderConfig(process.env));
  return { fiscalYear: fy, grants: lines };
}

export async function fundStatementsRoutes(app: FastifyInstance): Promise<void> {
  const serve = <T>(build: (tx: Tx, tenantId: string, fy: string, comparatives: boolean) => Promise<T>) =>
    async (req: FastifyRequest, reply: FastifyReply) => {
      const ctx = resolveContext(req);
      requireRole(ctx, READER_ROLES);
      const q = query.parse(req.query);
      const fy = q.fy ?? currentFyIST();
      const body = await guard(() => scopedRead(async (tx) => {
        await requireEnabled(tx, ctx.tenantId);
        return build(tx, ctx.tenantId, fy, q.comparatives === "true");
      }));
      return reply.send(body);
    };

  // Which statement set (and routes) this tenant uses: govt -> the existing routes, nonprofit -> the fund-wise set. Additive; reads one row.
  app.get("/v1/finance/statements/set-for-tenant", async (req) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const st = await scopedRead((tx) => loadStatementSettings(tx, ctx.tenantId));
    const template = st.coaTemplate;
    // entityType is reported for a commercial tenant only, so the govt / nonprofit payload is byte-identical to before M8
    return { coaTemplate: template ?? "govt", ...(template === "commercial" ? { entityType: st.entityType } : {}), ...statementSetFor(template, st.entityType) };
  });
  app.get("/v1/finance/statements/fund-wise/balance-sheet", serve(balanceSheetFor));
  app.get("/v1/finance/statements/fund-wise/income-expenditure", serve(incomeExpenditureFor));
  app.get("/v1/finance/statements/fund-wise/receipts-payments", serve((tx, t, fy) => receiptsPaymentsFor(tx, t, fy)));
  app.get("/v1/finance/statements/fund-wise/utilisation-certificates", serve((tx, t, fy) => utilisationFor(tx, t, fy)));
  app.get("/v1/finance/statements/fund-wise/set", serve(async (tx, t, fy, comparatives) => ({
    fiscalYear: fy,
    balanceSheet: await balanceSheetFor(tx, t, fy, comparatives),
    incomeExpenditure: await incomeExpenditureFor(tx, t, fy, comparatives),
    receiptsPayments: await receiptsPaymentsFor(tx, t, fy),
    utilisationCertificates: await utilisationFor(tx, t, fy),
  })));

  app.setErrorHandler(financeErrorHandler);
}
