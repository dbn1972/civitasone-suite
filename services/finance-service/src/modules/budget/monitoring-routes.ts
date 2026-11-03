import type { FastifyInstance } from "fastify";
import { resolveContext, requireRole, HttpError, financeErrorHandler } from "../../shared/context.js";
import * as allocRepo from "./allocation-repo.js";
import { findHeadLabels } from "./repo.js";
import { bookedLines, lineFor } from "./monitoring-books.js";
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

type HeadLabels = Map<string, { code: string; name: string }>;
type Books = Map<string, MonitorLine>;

// UAT P2 (A7, recon D20): every figure below is the books-based line (monitoring-books.ts): Expended is what the
// ledger has booked to the head in the FY (it read the allocation's payment-settled actual, so a Rs 270 JV showed
// Rs 0), and Committed excludes bills already booked, so nothing is counted twice.
const bookOf = (r: BudgetAllocationRow, books: Books): MonitorLine => lineFor(r, books);

function serializeLine(r: BudgetAllocationRow, elapsedBps: bigint, labels: HeadLabels, books: Books) {
  const line = bookOf(r, books);
  const head = labels.get(r.headId);
  return {
    id: r.id, headId: r.headId,
    // GAP-FINANCE-BUDGET-MONITORING-02: officers identify heads by code/name,
    // not uuid. null when the head no longer resolves in this tenant.
    headCode: head?.code ?? null, headName: head?.name ?? null,
    fy: r.fy,
    allocatedMinor: line.allocatedMinor.toString(),
    committedMinor: line.committedMinor.toString(),
    actualMinor: line.actualMinor.toString(),
    availableMinor: availableMinor(line).toString(),
    burnRateBps: burnRateBps(line.allocatedMinor, line.actualMinor).toString(),
    utilisationBps: utilisationBps(line).toString(),
    forecastYearEndMinor: forecastYearEndMinor(line.actualMinor, elapsedBps).toString(),
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
    const [labels, books] = await Promise.all([
      findHeadLabels(ctx.tenantId, rows.map((r) => r.headId)),
      bookedLines(ctx.tenantId, rows),
    ]);
    const totals = summarisePortfolio(rows.map((r) => bookOf(r, books)), elapsedBps);
    return reply.send({
      fy: q.fy,
      asOf: (q.asOf ?? new Date().toISOString().slice(0, 10)),
      fractionElapsedBps: elapsedBps.toString(),
      totals: serializeTotals(totals),
      lines: rows.map((r) => serializeLine(r, elapsedBps, labels, books)),
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
    const [labels, books] = await Promise.all([
      findHeadLabels(ctx.tenantId, rows.map((r) => r.headId)),
      bookedLines(ctx.tenantId, rows),
    ]);
    const lines = rows.map((r) => serializeLine(r, elapsedBps, labels, books)).filter((l) => l.exception !== "on_track");
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
    const books = await bookedLines(ctx.tenantId, rows);
    return reply.send({ fy: q.fy, fractionElapsedBps: elapsedBps.toString(), totals: serializeTotals(summarisePortfolio(rows.map((r) => bookOf(r, books)), elapsedBps)) });
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
