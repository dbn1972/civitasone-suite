import type { FastifyInstance } from "fastify";
import { resolveContext, requireRole, HttpError, financeErrorHandler } from "../../shared/context.js";
import * as allocRepo from "./allocation-repo.js";
import { findHeadLabels, findBudgetUtilisedByHead } from "./repo.js";
import {
  availableMinor, burnRateBps, utilisationBps, fractionElapsedBps,
  forecastYearEndMinor, classifyException, summarisePortfolio,
  type MonitorLine, type ExceptionKind,
} from "./monitoring-domain.js";
import { DomainError } from "./domain.js";
import { monitoringQuery } from "./monitoring-validators.js";
import type { BudgetAllocationRow } from "./allocation-schema.js";

const READER_ROLES = ["finance_officer", "finance_admin", "super_admin", "audit_officer"];

function asOfDate(s?: string): Date {
  return s ? new Date(`${s}T00:00:00Z`) : new Date();
}

function lineOf(r: BudgetAllocationRow): MonitorLine {
  return { allocatedMinor: r.allocatedMinor, committedMinor: r.committedMinor, actualMinor: r.actualMinor };
}

type HeadLabels = Map<string, { code: string; name: string }>;
/** head id -> paise posted in the GL against that head's budget estimate for the FY (finance_budgets.utilised_minor). */
type PostedByHead = Map<string, bigint>;

function serializeLine(r: BudgetAllocationRow, elapsedBps: bigint, labels: HeadLabels, posted: PostedByHead) {
  const line = lineOf(r);
  const head = labels.get(r.headId);
  const postedMinor = posted.get(r.headId);
  return {
    id: r.id, headId: r.headId,
    // GAP-FINANCE-BUDGET-MONITORING-02: officers identify heads by code/name,
    // not uuid. null when the head no longer resolves in this tenant.
    headCode: head?.code ?? null, headName: head?.name ?? null,
    fy: r.fy,
    allocatedMinor: r.allocatedMinor.toString(),
    committedMinor: r.committedMinor.toString(),
    actualMinor: r.actualMinor.toString(),
    // UAT P2 (A7, recon D20): actualMinor is what bill payments have drawn from this allocation; a journal posted
    // straight to the head (e.g. the Rs 270 JV on UT3E2192) never touches the allocation, so Expended read Rs 0 while
    // the ledger had the posting. postedMinor is the GL figure counted against the head's budget estimate, shown
    // beside it. null = the head has no budget estimate for the FY (not budget-controlled), never a made-up 0.
    // It does NOT change available/utilisation: whether a direct journal should consume the allocation is an
    // open owner decision (see the PR).
    postedMinor: postedMinor === undefined ? null : postedMinor.toString(),
    availableMinor: availableMinor(line).toString(),
    burnRateBps: burnRateBps(r.allocatedMinor, r.actualMinor).toString(),
    utilisationBps: utilisationBps(line).toString(),
    forecastYearEndMinor: forecastYearEndMinor(r.actualMinor, elapsedBps).toString(),
    exception: classifyException(line, elapsedBps),
  };
}

export async function budgetMonitoringRoutes(app: FastifyInstance): Promise<void> {
  // Full monitoring dashboard: per-head allocation/commitment/expenditure/
  // availability + burn rate + year-end forecast + exception flag, plus totals.
  app.get("/v1/finance/budget-monitoring", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = monitoringQuery.parse(req.query);
    let elapsedBps: bigint;
    try {
      elapsedBps = fractionElapsedBps(q.fy, asOfDate(q.asOf));
    } catch (err) {
      if (err instanceof DomainError) throw new HttpError(400, err.code, err.message);
      throw err;
    }
    const rows = await allocRepo.listAllocations(ctx.tenantId, q.fy, q.limit);
    const [labels, posted] = await Promise.all([
      findHeadLabels(ctx.tenantId, rows.map((r) => r.headId)),
      findBudgetUtilisedByHead(ctx.tenantId, q.fy, rows.map((r) => r.headId)),
    ]);
    const totals = summarisePortfolio(rows.map(lineOf), elapsedBps);
    return reply.send({
      fy: q.fy,
      asOf: (q.asOf ?? new Date().toISOString().slice(0, 10)),
      fractionElapsedBps: elapsedBps.toString(),
      totals: { ...serializeTotals(totals), postedMinor: [...posted.values()].reduce((s, v) => s + v, 0n).toString() },
      lines: rows.map((r) => serializeLine(r, elapsedBps, labels, posted)),
    });
  });

  // Exception dashboard: only the heads that need attention.
  app.get("/v1/finance/budget-monitoring/exceptions", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = monitoringQuery.parse(req.query);
    let elapsedBps: bigint;
    try {
      elapsedBps = fractionElapsedBps(q.fy, asOfDate(q.asOf));
    } catch (err) {
      if (err instanceof DomainError) throw new HttpError(400, err.code, err.message);
      throw err;
    }
    const rows = await allocRepo.listAllocations(ctx.tenantId, q.fy, q.limit);
    const [labels, posted] = await Promise.all([
      findHeadLabels(ctx.tenantId, rows.map((r) => r.headId)),
      findBudgetUtilisedByHead(ctx.tenantId, q.fy, rows.map((r) => r.headId)),
    ]);
    const lines = rows.map((r) => serializeLine(r, elapsedBps, labels, posted)).filter((l) => l.exception !== "on_track");
    return reply.send({ fy: q.fy, count: lines.length, lines });
  });

  // Portfolio summary only (totals + exception counts).
  app.get("/v1/finance/budget-monitoring/summary", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = monitoringQuery.parse(req.query);
    let elapsedBps: bigint;
    try {
      elapsedBps = fractionElapsedBps(q.fy, asOfDate(q.asOf));
    } catch (err) {
      if (err instanceof DomainError) throw new HttpError(400, err.code, err.message);
      throw err;
    }
    const rows = await allocRepo.listAllocations(ctx.tenantId, q.fy, q.limit);
    return reply.send({ fy: q.fy, fractionElapsedBps: elapsedBps.toString(), totals: serializeTotals(summarisePortfolio(rows.map(lineOf), elapsedBps)) });
  });

  app.setErrorHandler(financeErrorHandler);
}

function serializeTotals(t: ReturnType<typeof summarisePortfolio>) {
  const ex = t.exceptions as Record<ExceptionKind, number>;
  return {
    count: t.count,
    allocatedMinor: t.allocatedMinor.toString(),
    committedMinor: t.committedMinor.toString(),
    actualMinor: t.actualMinor.toString(),
    availableMinor: t.availableMinor.toString(),
    forecastYearEndMinor: t.forecastYearEndMinor.toString(),
    exceptions: ex,
  };
}
