import type { FastifyInstance } from "fastify";
import { sql } from "drizzle-orm";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import { enqueue } from "../../shared/outbox.js";
import { findProjectByIdTx } from "./repo.js";
import {
  projectIdParam, billParam, extParam,
  createRiskBody, computeEvmBody, createRaBillBody, createTimeExtBody,
  createPenaltyBody, createResourceBody,
} from "./world-class-validators.js";

const PROJ_ROLES   = ["project_manager", "project_officer", "super_admin"];
const READER_ROLES = [...PROJ_ROLES, "audit_officer", "finance_officer"];
const AUDIT_TOPIC  = "audit.event.record";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// P0-1: a world-class child may only be created under a project that belongs to
// the caller's tenant. Throws 404 (matching the core's not-found semantics)
// when the parent is missing or owned by another tenant.
async function assertParent(tx: Tx, projectId: string, tenantId: string): Promise<void> {
  const parent = await findProjectByIdTx(tx, projectId, tenantId);
  if (!parent) throw new HttpError(404, "NOT_FOUND", "project not found");
}

// P1-1: emit an audit event on the same tx as the business write (outbox).
async function audit(
  tx: Tx, ctx: { tenantId: string; actorId: string; correlationId: string },
  action: string, resourceType: string, resourceId: string,
): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId,
    payload: { service: "project", action, resourceType, resourceId, outcome: "success" },
  });
}

export async function worldClassProjectRoutes(app: FastifyInstance): Promise<void> {

  // ─── Risk Register ───────────────────────────────────────────────────────────

  app.get("/v1/projects/:id/risks", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = projectIdParam.parse(req.params);
    const rows = await db.execute(sql`
      SELECT * FROM project.project_risks
      WHERE tenant_id = ${ctx.tenantId} AND project_id = ${id}
      ORDER BY created_at DESC
    `);
    return reply.send({ data: rows });
  });

  app.post("/v1/projects/:id/risks", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PROJ_ROLES);
    const { id } = projectIdParam.parse(req.params);
    const b = createRiskBody.parse(req.body);
    const riskScore = computeRiskScore(b.probability, b.impact);
    const newId = await db.transaction(async (tx) => {
      await assertParent(tx, id, ctx.tenantId);
      const rows = await tx.execute(sql`
        INSERT INTO project.project_risks (tenant_id, project_id, title, description, category, probability, impact, risk_score, mitigation_plan, owner_id, status, created_by)
        VALUES (${ctx.tenantId}, ${id}, ${b.title}, ${b.description ?? null}, ${b.category}, ${b.probability}, ${b.impact}, ${riskScore}, ${b.mitigationPlan ?? null}, ${b.ownerId ?? null}, ${b.status}, ${ctx.actorId})
        RETURNING id
      `);
      const rid = (rows[0] as { id: string }).id;
      await audit(tx, ctx, "create", "project_risk", rid);
      return rid;
    });
    return reply.code(201).send({ id: newId, message: "risk created" });
  });

  // ─── Earned Value Management ─────────────────────────────────────────────────

  app.get("/v1/projects/:id/evm", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = projectIdParam.parse(req.params);

    // Check if a baseline exists in new baselines table (Req 11.5)
    const baselineCheck = await db.execute(sql`
      SELECT id, label FROM project.baselines
      WHERE tenant_id = ${ctx.tenantId} AND project_id = ${id}
      ORDER BY created_at DESC LIMIT 1
    `);

    // Also check legacy project_baselines for backward compat
    if (baselineCheck.length === 0) {
      const legacyCheck = await db.execute(sql`
        SELECT id FROM project.project_baselines
        WHERE tenant_id = ${ctx.tenantId} AND project_id = ${id}
        LIMIT 1
      `);
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
    const rows = await db.execute(sql`
      SELECT * FROM project.project_evm
      WHERE tenant_id = ${ctx.tenantId} AND project_id = ${id}
      ORDER BY period DESC
    `);
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
    await db.transaction(async (tx) => {
      await assertParent(tx, id, ctx.tenantId);
      await tx.execute(sql`
        INSERT INTO project.project_evm (tenant_id, project_id, period, planned_value_minor, earned_value_minor, actual_cost_minor, cpi, spi, eac_minor, etc_minor, variance_at_completion_minor)
        VALUES (${ctx.tenantId}, ${id}, ${b.period}, ${pv}, ${ev}, ${ac}, ${cpi}, ${spi}, ${eac}, ${etc}, ${vac})
        ON CONFLICT (tenant_id, project_id, period) DO UPDATE SET
          planned_value_minor = EXCLUDED.planned_value_minor,
          earned_value_minor = EXCLUDED.earned_value_minor,
          actual_cost_minor = EXCLUDED.actual_cost_minor,
          cpi = EXCLUDED.cpi, spi = EXCLUDED.spi,
          eac_minor = EXCLUDED.eac_minor, etc_minor = EXCLUDED.etc_minor,
          variance_at_completion_minor = EXCLUDED.variance_at_completion_minor,
          computed_at = NOW()
      `);
      await audit(tx, ctx, "compute", "project_evm", `${id}:${b.period}`);
    });
    return reply.code(201).send({
      message: "evm computed", cpi, spi,
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
    const rows = await db.execute(sql`
      SELECT * FROM project.project_ra_bills
      WHERE tenant_id = ${ctx.tenantId} AND project_id = ${id}
      ORDER BY bill_date DESC
    `);
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
    const newId = await db.transaction(async (tx) => {
      await assertParent(tx, id, ctx.tenantId);
      const rows = await tx.execute(sql`
        INSERT INTO project.project_ra_bills (tenant_id, project_id, contractor_id, contractor_name, bill_no, bill_date, work_description, gross_amount_minor, deductions_minor, net_amount_minor, cumulative_minor, status, created_by)
        VALUES (${ctx.tenantId}, ${id}, ${b.contractorId}, ${b.contractorName ?? null}, ${b.billNo}, ${b.billDate}, ${b.workDescription ?? null}, ${gross}, ${deductions}, ${net}, ${cumulative}, ${"submitted"}, ${ctx.actorId})
        RETURNING id
      `);
      const rid = (rows[0] as { id: string }).id;
      await audit(tx, ctx, "submit", "ra_bill", rid);
      return rid;
    });
    return reply.code(201).send({ id: newId, message: "ra bill submitted" });
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
      // P0-2 SoD: the submitter may not approve their own bill.
      if (row.created_by === ctx.actorId) {
        throw new HttpError(403, "SOD_VIOLATION", "approver must differ from submitter");
      }
      // P1-3: state guard — only a submitted/verified bill can be approved.
      const upd = await tx.execute(sql`
        UPDATE project.project_ra_bills
        SET status = 'approved', approved_by = ${ctx.actorId}
        WHERE id = ${billId} AND tenant_id = ${ctx.tenantId} AND project_id = ${id}
          AND status IN ('submitted','verified')
        RETURNING id
      `);
      if (upd.length === 0) throw new HttpError(409, "CONFLICT", "ra bill is not in an approvable state");
      await audit(tx, ctx, "approve", "ra_bill", billId);
    });
    return reply.send({ message: "ra bill approved" });
  });

  // ─── Time Extensions ────────────────────────────────────────────────────────

  app.get("/v1/projects/:id/time-extensions", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = projectIdParam.parse(req.params);
    const rows = await db.execute(sql`
      SELECT * FROM project.project_time_extensions
      WHERE tenant_id = ${ctx.tenantId} AND project_id = ${id}
      ORDER BY created_at DESC
    `);
    return reply.send({ data: rows });
  });

  app.post("/v1/projects/:id/time-extensions", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PROJ_ROLES);
    const { id } = projectIdParam.parse(req.params);
    const b = createTimeExtBody.parse(req.body);
    const penaltyPerDay = BigInt(b.penaltyPerDayMinor);
    const newId = await db.transaction(async (tx) => {
      await assertParent(tx, id, ctx.tenantId);
      const rows = await tx.execute(sql`
        INSERT INTO project.project_time_extensions (tenant_id, project_id, original_end_date, extended_end_date, extension_days, reason, penalty_applicable, penalty_per_day_minor, status, created_by)
        VALUES (${ctx.tenantId}, ${id}, ${b.originalEndDate}, ${b.extendedEndDate}, ${b.extensionDays}, ${b.reason}, ${b.penaltyApplicable}, ${penaltyPerDay}, ${"requested"}, ${ctx.actorId})
        RETURNING id
      `);
      const rid = (rows[0] as { id: string }).id;
      await audit(tx, ctx, "request", "time_extension", rid);
      return rid;
    });
    return reply.code(201).send({ id: newId, message: "time extension requested" });
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
      // P0-2 SoD: the requester may not approve their own extension.
      if (row.created_by === ctx.actorId) {
        throw new HttpError(403, "SOD_VIOLATION", "approver must differ from requester");
      }
      // P1-3: state guard — only a requested extension can be approved.
      const upd = await tx.execute(sql`
        UPDATE project.project_time_extensions
        SET status = 'approved', approved_by = ${ctx.actorId}, approval_date = CURRENT_DATE
        WHERE id = ${extId} AND tenant_id = ${ctx.tenantId} AND project_id = ${id}
          AND status = 'requested'
        RETURNING id
      `);
      if (upd.length === 0) throw new HttpError(409, "CONFLICT", "time extension is not in an approvable state");
      await audit(tx, ctx, "approve", "time_extension", extId);
    });
    return reply.send({ message: "time extension approved" });
  });

  // ─── Penalties / Liquidated Damages ─────────────────────────────────────────

  app.get("/v1/projects/:id/penalties", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = projectIdParam.parse(req.params);
    const rows = await db.execute(sql`
      SELECT * FROM project.project_penalties
      WHERE tenant_id = ${ctx.tenantId} AND project_id = ${id}
      ORDER BY created_at DESC
    `);
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
    const newId = await db.transaction(async (tx) => {
      await assertParent(tx, id, ctx.tenantId);
      const rows = await tx.execute(sql`
        INSERT INTO project.project_penalties (tenant_id, project_id, contractor_id, penalty_type, from_date, to_date, days, rate_per_day_minor, total_minor, recovered, recovered_from, created_by)
        VALUES (${ctx.tenantId}, ${id}, ${b.contractorId ?? null}, ${b.penaltyType}, ${b.fromDate}, ${b.toDate}, ${b.days}, ${ratePerDay}, ${total}, ${false}, ${b.recoveredFrom ?? null}, ${ctx.actorId})
        RETURNING id
      `);
      const rid = (rows[0] as { id: string }).id;
      await audit(tx, ctx, "levy", "penalty", rid);
      return rid;
    });
    return reply.code(201).send({ id: newId, message: "penalty levied", totalMinor: total.toString() });
  });

  // ─── Resource Allocation ────────────────────────────────────────────────────

  app.get("/v1/projects/:id/resources", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = projectIdParam.parse(req.params);
    const rows = await db.execute(sql`
      SELECT * FROM project.project_resources
      WHERE tenant_id = ${ctx.tenantId} AND project_id = ${id}
      ORDER BY created_at DESC
    `);
    return reply.send({ data: rows });
  });

  app.post("/v1/projects/:id/resources", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PROJ_ROLES);
    const { id } = projectIdParam.parse(req.params);
    const b = createResourceBody.parse(req.body);
    const dailyRate = BigInt(b.dailyRateMinor);
    const newId = await db.transaction(async (tx) => {
      await assertParent(tx, id, ctx.tenantId);
      const rows = await tx.execute(sql`
        INSERT INTO project.project_resources (tenant_id, project_id, task_id, resource_type, resource_id, resource_name, allocated_hours, daily_rate_minor, from_date, to_date, status, created_by)
        VALUES (${ctx.tenantId}, ${id}, ${b.taskId ?? null}, ${b.resourceType}, ${b.resourceId ?? null}, ${b.resourceName}, ${b.allocatedHours ?? null}, ${dailyRate}, ${b.fromDate ?? null}, ${b.toDate ?? null}, ${"allocated"}, ${ctx.actorId})
        RETURNING id
      `);
      const rid = (rows[0] as { id: string }).id;
      await audit(tx, ctx, "allocate", "resource", rid);
      return rid;
    });
    return reply.code(201).send({ id: newId, message: "resource allocated" });
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
