/**
 * MSME M8: entity-type-driven commercial statements. ADDITIVE routes under /v1/finance/statements/commercial/...; the govt and
 * fund-wise routes are not touched. Every route answers 404 STATEMENT_SET_NOT_AVAILABLE unless the STORED chart template is
 * `commercial` and a STORED entity_type is set (statement-set.ts) -- a govt / nonprofit tenant sees nothing here.
 *
 *  GET .../commercial/set?fy=               the family's whole set (P&L, Balance Sheet, Cash Flow | Trading Account, notes)
 *  GET .../commercial/profit-and-loss?fy=   GET .../commercial/balance-sheet?fy=
 *  GET .../commercial/cash-flow?fy=         (schedule_iii family)    GET .../commercial/trading-account?fy=   (trading_pl_bs family)
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError, financeErrorHandler } from "../../shared/context.js";
import { scopedRead } from "../../shared/db.js";
import { currentFyIST } from "../../shared/ist-date.js";
import { CommercialChartIncompleteError } from "../gl/commercial-chart.js";
import type { Tx } from "../year-end/repo.js";
import { buildCommercialSet, StatementClassMissingError, type CommercialSet } from "./commercial-statements.js";
import { commercialPresentation, frameworkFromEnv, loadCommercialRows, loadStatementSettings } from "./commercial-statements-repo.js";
import { statementSetFor } from "./statement-set.js";

const READER_ROLES = ["finance_officer", "finance_admin", "super_admin", "audit_officer"];
const query = z.object({ fy: z.string().regex(/^\d{4}-\d{2}$/, "fy must be a financial year such as 2026-27").optional() });

async function buildFor(tx: Tx, tenantId: string, fy: string): Promise<CommercialSet> {
  const st = await loadStatementSettings(tx, tenantId);
  const set = statementSetFor(st.coaTemplate, st.entityType);
  if (set.id !== "commercial" || !set.available || !set.family) throw new HttpError(404, "STATEMENT_SET_NOT_AVAILABLE", "the commercial statement set is not available for this tenant (needs the commercial chart and a stored entity type)");
  const rows = await loadCommercialRows(tx, tenantId, fy);
  return buildCommercialSet(rows, commercialPresentation(), { family: set.family, fy, framework: frameworkFromEnv(process.env), accountingBasis: st.accountingBasis, llp: st.entityType === "llp" });
}

export async function commercialStatementsRoutes(app: FastifyInstance): Promise<void> {
  const serve = (pick: (s: CommercialSet) => unknown, needs?: "cashFlow" | "tradingAccount") =>
    async (req: FastifyRequest, reply: FastifyReply) => {
      const ctx = resolveContext(req);
      requireRole(ctx, READER_ROLES);
      const fy = query.parse(req.query).fy ?? currentFyIST();
      try {
        const s = await scopedRead((tx) => buildFor(tx, ctx.tenantId, fy));
        if (needs && !s[needs]) throw new HttpError(404, "STATEMENT_NOT_IN_FAMILY", `${needs === "cashFlow" ? "the Cash Flow Statement" : "the Trading Account"} is not part of the ${s.family} family`);
        return reply.send(pick(s));
      } catch (err) {
        if (err instanceof StatementClassMissingError) throw new HttpError(409, err.code, err.message);
        if (err instanceof CommercialChartIncompleteError) throw new HttpError(409, err.code, err.message.replace(/^\[[A-Z_]+\]\s*/, ""));
        throw err;
      }
    };
  app.get("/v1/finance/statements/commercial/set", serve((s) => s));
  app.get("/v1/finance/statements/commercial/profit-and-loss", serve((s) => ({ fiscalYear: s.fiscalYear, family: s.family, framework: s.framework, ...s.profitAndLoss })));
  app.get("/v1/finance/statements/commercial/balance-sheet", serve((s) => ({ fiscalYear: s.fiscalYear, ...s.balanceSheet })));
  app.get("/v1/finance/statements/commercial/cash-flow", serve((s) => ({ fiscalYear: s.fiscalYear, ...s.cashFlow }), "cashFlow"));
  app.get("/v1/finance/statements/commercial/trading-account", serve((s) => ({ fiscalYear: s.fiscalYear, ...s.tradingAccount }), "tradingAccount"));
  app.setErrorHandler(financeErrorHandler);
}
