import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as allocRepo from "./allocation-repo.js";
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

function serializeLine(r: BudgetAllocationRow, elapsedBps: bigint) {
  const line = lineOf(r);
  return {
    id: r.id, headId: r.headId, fy: r.fy,
    allocatedMinor: r.allocatedMinor.toString(),
    committedMinor: r.committedMinor.toString(),
    actualMinor: r.actualMinor.toString(),
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
    const totals = summarisePortfolio(rows.map(lineOf), elapsedBps);
    return reply.send({
      fy: q.fy,
      asOf: (q.asOf ?? new Date().toISOString().slice(0, 10)),
      fractionElapsedBps: elapsedBps.toString(),
      totals: serializeTotals(totals),
      lines: rows.map((r) => serializeLine(r, elapsedBps)),
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
    const lines = rows.map((r) => serializeLine(r, elapsedBps)).filter((l) => l.exception !== "on_track");
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

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
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
