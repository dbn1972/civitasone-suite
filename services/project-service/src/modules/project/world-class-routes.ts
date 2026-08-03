import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import { publishF3Write } from "../../shared/f3-publish.js";
import { findProjectByIdTx } from "./repo.js";
import {
  projectIdParam, billParam, extParam,
  createRiskBody, computeEvmBody, createRaBillBody, createTimeExtBody,
  createPenaltyBody, createResourceBody,
} from "./world-class-validators.js";

const PROJ_ROLES   = ["project_manager", "project_officer", "super_admin"];
const READER_ROLES = [...PROJ_ROLES, "audit_officer", "finance_officer"];

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// P0-1: a world-class child may only be created under a project that belongs to
// the caller's tenant. Throws 404 (matching the core's not-found semantics)
// when the parent is missing or owned by another tenant.
async function assertParent(tx: Tx, projectId: string, tenantId: string): Promise<void> {
  const parent = await findProjectByIdTx(tx, projectId, tenantId);
  if (!parent) throw new HttpError(404, "NOT_FOUND", "project not found");
}

export async function worldClassProjectRoutes(app: FastifyInstance): Promise<void> {

  // ─── Risk Register ───────────────────────────────────────────────────────────

  app.get("/v1/projects/:id/risks", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = projectIdParam.parse(req.params);
    const rows = await db.transaction((tx) => tx.execute(sql`
      SELECT * FROM project.project_risks
      WHERE tenant_id = ${ctx.tenantId} AND project_id = ${id}
      ORDER BY created_at DESC
    `));
    return reply.send({ data: rows });
  });

  app.post("/v1/projects/:id/risks", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PROJ_ROLES);
    const { id } = projectIdParam.parse(req.params);
    const b = createRiskBody.parse(req.body);
    const riskScore = computeRiskScore(b.probability, b.impact);
    await db.transaction(async (tx) => { await assertParent(tx, id, ctx.tenantId); });
    const newId = randomUUID();
    await publishF3Write(ctx, "risk_create", newId, {
      projectId: id,
      title: b.title,
      description: b.description,
      category: b.category,
      probability: b.probability,
      impact: b.impact,
      riskScore,
      mitigationPlan: b.mitigationPlan,
      ownerId: b.ownerId,
      status: b.status,
    });
    return reply.code(202).send({ id: newId, status: "accepted", correlationId: ctx.correlationId });
  });

  // ─── Earned Value Management ─────────────────────────────────────────────────

  app.get("/v1/projects/:id/evm", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = projectIdParam.parse(req.params);

    // Check if a baseline exists in new baselines table (Req 11.5)
    const baselineCheck = await db.transaction((tx) => tx.execute(sql`
      SELECT id, label FROM project.baselines
      WHERE tenant_id = ${ctx.tenantId} AND project_id = ${id}
      ORDER BY created_at DESC LIMIT 1
    `));

    // Also check legacy project_baselines for backward compat
    if (baselineCheck.length === 0) {
      const legacyCheck = await db.transaction((tx) => tx.execute(sql`
        SELECT id FROM project.project_baselines
        WHERE tenant_id = ${ctx.tenantId} AND project_id = ${id}
        LIMIT 1
      `));
      if (legacyCheck.length === 0) {
        throw new HttpError(422, "BASELINE_REQUIRED", "a baseline snapshot is required before EVM metrics can be computed");
      }
    }

    // If pv/ev/ac query params present, compute real-time EVM metrics
    const query = req.query as Record<string, string | undefined>;
    if (query.pv !== undefined && query.ev !== undefined && query.ac !== undefined) {
      const { computeEvm } = await import("../scheduling/evm.js");
      const pv = BigInt(query.pv);
      const ev = BigInt(query.ev);
      const ac = BigInt(query.ac);
      const metrics = computeEvm(pv, ev, ac);
      const baseline = baselineCheck[0] as { id: string; label: string } | undefined;
      return reply.send({
        data: {
          baselineId: baseline?.id ?? null,
          baselineLabel: baseline?.label ?? null,
          pv: metrics.pv.toString(),
          ev: metrics.ev.toString(),
          ac: metrics.ac.toString(),
          spi: metrics.spi,
          cpi: metrics.cpi,
        },
      });
    }

    // Fallback: return historical EVM records
    const rows = await db.transaction((tx) => tx.execute(sql`
      SELECT * FROM project.project_evm
      WHERE tenant_id = ${ctx.tenantId} AND project_id = ${id}
      ORDER BY period DESC
    `));
    return reply.send({ data: rows });
  });

  app.post("/v1/projects/:id/evm/compute", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PROJ_ROLES);
    const { id } = projectIdParam.parse(req.params);
    const b = computeEvmBody.parse(req.body);
    // P0-3: paise stay in BigInt; ratios (cpi/spi) are decimals for display only.
    const pv = BigInt(b.plannedValueMinor);
    const ev = BigInt(b.earnedValueMinor);
    const ac = BigInt(b.actualCostMinor);
    const bac = b.budgetAtCompletionMinor !== undefined ? BigInt(b.budgetAtCompletionMinor) : pv;
    const cpi = ac > 0n ? Number(ev) / Number(ac) : null;
    const spi = pv > 0n ? Number(ev) / Number(pv) : null;
    // EAC = BAC / CPI, computed exactly in integer paise: (bac * ac) / ev.
    const eac = ev > 0n ? (bac * ac) / ev : null;
    const etc = eac !== null ? eac - ac : null;
    const vac = eac !== null ? bac - eac : null;
    await db.transaction(async (tx) => { await assertParent(tx, id, ctx.tenantId); });
    const evmId = `${id}:${b.period}`;
    await publishF3Write(ctx, "evm_compute", evmId, {
      projectId: id,
      period: b.period,
      pv,
      ev,
      ac,
      cpi,
      spi,
      eac,
      etc,
      vac,
    });
    return reply.code(202).send({
      status: "accepted",
      correlationId: ctx.correlationId,
      cpi,
      spi,
      eacMinor: eac?.toString() ?? null,
      etcMinor: etc?.toString() ?? null,
      vacMinor: vac?.toString() ?? null,
    });
  });

  // ─── Contractor Billing (RA Bills) ──────────────────────────────────────────

  app.get("/v1/projects/:id/ra-bills", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = projectIdParam.parse(req.params);
    const rows = await db.transaction((tx) => tx.execute(sql`
      SELECT * FROM project.project_ra_bills
      WHERE tenant_id = ${ctx.tenantId} AND project_id = ${id}
      ORDER BY bill_date DESC
    `));
    return reply.send({ data: rows });
  });

  app.post("/v1/projects/:id/ra-bills", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PROJ_ROLES);
    const { id } = projectIdParam.parse(req.params);
    const b = createRaBillBody.parse(req.body);
    // P0-3: amounts stay BigInt paise.
    const gross = BigInt(b.grossAmountMinor);
    const deductions = BigInt(b.deductionsMinor);
    const net = BigInt(b.netAmountMinor);
    const cumulative = BigInt(b.cumulativeMinor);
    await db.transaction(async (tx) => { await assertParent(tx, id, ctx.tenantId); });
    const newId = randomUUID();
    await publishF3Write(ctx, "ra_bill_create", newId, {
      projectId: id,
      contractorId: b.contractorId,
      contractorName: b.contractorName,
      billNo: b.billNo,
      billDate: b.billDate,
      workDescription: b.workDescription,
      gross,
      deductions,
      net,
      cumulative,
    });
    return reply.code(202).send({ id: newId, status: "accepted", correlationId: ctx.correlationId });
  });

  app.post("/v1/projects/:id/ra-bills/:billId/approve", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PROJ_ROLES);
    const { id, billId } = billParam.parse(req.params);
    await db.transaction(async (tx) => {
      const rows = await tx.execute(sql`
        SELECT created_by, status FROM project.project_ra_bills
        WHERE id = ${billId} AND tenant_id = ${ctx.tenantId} AND project_id = ${id}
        FOR UPDATE
      `);
      const row = rows[0] as { created_by: string; status: string } | undefined;
      if (!row) throw new HttpError(404, "NOT_FOUND", "ra bill not found");
      if (row.created_by === ctx.actorId) {
        throw new HttpError(403, "SOD_VIOLATION", "approver must differ from submitter");
      }
      if (!["submitted", "verified"].includes(row.status)) {
        throw new HttpError(409, "CONFLICT", "ra bill is not in an approvable state");
      }
    });
    await publishF3Write(ctx, "ra_bill_approve", billId, { projectId: id, billId });
    return reply.code(202).send({ status: "accepted", correlationId: ctx.correlationId });
  });

  // ─── Time Extensions ────────────────────────────────────────────────────────

  app.get("/v1/projects/:id/time-extensions", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = projectIdParam.parse(req.params);
    const rows = await db.transaction((tx) => tx.execute(sql`
      SELECT * FROM project.project_time_extensions
      WHERE tenant_id = ${ctx.tenantId} AND project_id = ${id}
      ORDER BY created_at DESC
    `));
    return reply.send({ data: rows });
  });

  app.post("/v1/projects/:id/time-extensions", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PROJ_ROLES);
    const { id } = projectIdParam.parse(req.params);
    const b = createTimeExtBody.parse(req.body);
    const penaltyPerDay = BigInt(b.penaltyPerDayMinor);
    await db.transaction(async (tx) => { await assertParent(tx, id, ctx.tenantId); });
    const newId = randomUUID();
    await publishF3Write(ctx, "time_ext_create", newId, {
      projectId: id,
      originalEndDate: b.originalEndDate,
      extendedEndDate: b.extendedEndDate,
      extensionDays: b.extensionDays,
      reason: b.reason,
      penaltyApplicable: b.penaltyApplicable,
      penaltyPerDay,
    });
    return reply.code(202).send({ id: newId, status: "accepted", correlationId: ctx.correlationId });
  });

  app.post("/v1/projects/:id/time-extensions/:extId/approve", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PROJ_ROLES);
    const { id, extId } = extParam.parse(req.params);
    await db.transaction(async (tx) => {
      const rows = await tx.execute(sql`
        SELECT created_by, status FROM project.project_time_extensions
        WHERE id = ${extId} AND tenant_id = ${ctx.tenantId} AND project_id = ${id}
        FOR UPDATE
      `);
      const row = rows[0] as { created_by: string; status: string } | undefined;
      if (!row) throw new HttpError(404, "NOT_FOUND", "time extension not found");
      if (row.created_by === ctx.actorId) {
        throw new HttpError(403, "SOD_VIOLATION", "approver must differ from requester");
      }
      if (row.status !== "requested") {
        throw new HttpError(409, "CONFLICT", "time extension is not in an approvable state");
      }
    });
    await publishF3Write(ctx, "time_ext_approve", extId, { projectId: id, extId });
    return reply.code(202).send({ status: "accepted", correlationId: ctx.correlationId });
  });

  // ─── Penalties / Liquidated Damages ─────────────────────────────────────────

  app.get("/v1/projects/:id/penalties", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = projectIdParam.parse(req.params);
    const rows = await db.transaction((tx) => tx.execute(sql`
      SELECT * FROM project.project_penalties
      WHERE tenant_id = ${ctx.tenantId} AND project_id = ${id}
      ORDER BY created_at DESC
    `));
    return reply.send({ data: rows });
  });

  app.post("/v1/projects/:id/penalties", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PROJ_ROLES);
    const { id } = projectIdParam.parse(req.params);
    const b = createPenaltyBody.parse(req.body);
    // P0-3: total = days * ratePerDay computed strictly in BigInt paise.
    const ratePerDay = BigInt(b.ratePerDayMinor);
    const total = BigInt(b.days) * ratePerDay;
    await db.transaction(async (tx) => { await assertParent(tx, id, ctx.tenantId); });
    const newId = randomUUID();
    await publishF3Write(ctx, "penalty_create", newId, {
      projectId: id,
      contractorId: b.contractorId,
      penaltyType: b.penaltyType,
      fromDate: b.fromDate,
      toDate: b.toDate,
      days: b.days,
      ratePerDay,
      total,
      recoveredFrom: b.recoveredFrom,
    });
    return reply.code(202).send({ id: newId, status: "accepted", totalMinor: total.toString(), correlationId: ctx.correlationId });
  });

  // ─── Resource Allocation ────────────────────────────────────────────────────

  app.get("/v1/projects/:id/resources", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = projectIdParam.parse(req.params);
    const rows = await db.transaction((tx) => tx.execute(sql`
      SELECT * FROM project.project_resources
      WHERE tenant_id = ${ctx.tenantId} AND project_id = ${id}
      ORDER BY created_at DESC
    `));
    return reply.send({ data: rows });
  });

  app.post("/v1/projects/:id/resources", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PROJ_ROLES);
    const { id } = projectIdParam.parse(req.params);
    const b = createResourceBody.parse(req.body);
    const dailyRate = BigInt(b.dailyRateMinor);
    await db.transaction(async (tx) => { await assertParent(tx, id, ctx.tenantId); });
    const newId = randomUUID();
    await publishF3Write(ctx, "resource_allocate", newId, {
      projectId: id,
      taskId: b.taskId,
      resourceType: b.resourceType,
      resourceId: b.resourceId,
      resourceName: b.resourceName,
      allocatedHours: b.allocatedHours,
      dailyRate,
      fromDate: b.fromDate,
      toDate: b.toDate,
    });
    return reply.code(202).send({ id: newId, status: "accepted", correlationId: ctx.correlationId });
  });

  // ─── Baselines ──────────────────────────────────────────────────────────────
  // NOTE: Baselines and EVM routes moved to scheduling/baselines.ts (task 12.3)

  // ─── Error handler ──────────────────────────────────────────────────────────

  app.setErrorHandler(errorHandler);
}

function computeRiskScore(probability: string, impact: string): number {
  const levels: Record<string, number> = { low: 1, medium: 2, high: 3, critical: 4 };
  return (levels[probability] ?? 2) * (levels[impact] ?? 2);
}

function errorHandler(err: unknown, req: any, reply: any): void {
  const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
  if (err instanceof ZodError) {
    void reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false, fieldErrors: (err as ZodError).issues.map((i) => ({ field: i.path.join("."), message: i.message })) });
    return;
  }
  if (err instanceof HttpError) {
    void reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    return;
  }
  req.log.error({ err }, "unhandled error");
  void reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
}
