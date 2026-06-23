import type { FastifyInstance } from "fastify";
import { sql } from "drizzle-orm";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";

const PROJ_ROLES   = ["project_manager", "project_officer", "super_admin"];
const READER_ROLES = [...PROJ_ROLES, "audit_officer", "finance_officer"];

export async function worldClassProjectRoutes(app: FastifyInstance): Promise<void> {

  // ─── Risk Register ───────────────────────────────────────────────────────────

  app.get("/v1/projects/:id/risks", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = req.params as { id: string };
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
    const { id } = req.params as { id: string };
    const b = req.body as any;
    const riskScore = computeRiskScore(b.probability ?? "medium", b.impact ?? "medium");
    await db.execute(sql`
      INSERT INTO project.project_risks (tenant_id, project_id, title, description, category, probability, impact, risk_score, mitigation_plan, owner_id, status, created_by)
      VALUES (${ctx.tenantId}, ${id}, ${b.title}, ${b.description ?? null}, ${b.category ?? "technical"}, ${b.probability ?? "medium"}, ${b.impact ?? "medium"}, ${riskScore}, ${b.mitigationPlan ?? null}, ${b.ownerId ?? null}, ${b.status ?? "open"}, ${ctx.actorId})
    `);
    return reply.code(201).send({ message: "risk created" });
  });

  // ─── Earned Value Management ─────────────────────────────────────────────────

  app.get("/v1/projects/:id/evm", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = req.params as { id: string };
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
    const { id } = req.params as { id: string };
    const b = req.body as any;
    const pv = Number(b.plannedValueMinor ?? 0);
    const ev = Number(b.earnedValueMinor ?? 0);
    const ac = Number(b.actualCostMinor ?? 0);
    const cpi = ac > 0 ? (ev / ac) : null;
    const spi = pv > 0 ? (ev / pv) : null;
    const bac = Number(b.budgetAtCompletionMinor ?? pv);
    const eac = cpi && cpi > 0 ? Math.round(bac / cpi) : null;
    const etc = eac ? eac - ac : null;
    const vac = eac ? bac - eac : null;
    await db.execute(sql`
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
    return reply.code(201).send({ message: "evm computed", cpi, spi, eac, etc: etc, vac });
  });

  // ─── Contractor Billing (RA Bills) ──────────────────────────────────────────

  app.get("/v1/projects/:id/ra-bills", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = req.params as { id: string };
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
    const { id } = req.params as { id: string };
    const b = req.body as any;
    await db.execute(sql`
      INSERT INTO project.project_ra_bills (tenant_id, project_id, contractor_id, contractor_name, bill_no, bill_date, work_description, gross_amount_minor, deductions_minor, net_amount_minor, cumulative_minor, status, created_by)
      VALUES (${ctx.tenantId}, ${id}, ${b.contractorId}, ${b.contractorName ?? null}, ${b.billNo}, ${b.billDate}, ${b.workDescription ?? null}, ${b.grossAmountMinor}, ${b.deductionsMinor ?? 0}, ${b.netAmountMinor}, ${b.cumulativeMinor ?? 0}, ${"submitted"}, ${ctx.actorId})
    `);
    return reply.code(201).send({ message: "ra bill submitted" });
  });

  app.post("/v1/projects/:id/ra-bills/:billId/approve", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PROJ_ROLES);
    const { id, billId } = req.params as { id: string; billId: string };
    await db.execute(sql`
      UPDATE project.project_ra_bills
      SET status = 'approved', approved_by = ${ctx.actorId}
      WHERE id = ${billId} AND tenant_id = ${ctx.tenantId} AND project_id = ${id}
    `);
    return reply.send({ message: "ra bill approved" });
  });

  // ─── Time Extensions ────────────────────────────────────────────────────────

  app.get("/v1/projects/:id/time-extensions", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = req.params as { id: string };
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
    const { id } = req.params as { id: string };
    const b = req.body as any;
    await db.execute(sql`
      INSERT INTO project.project_time_extensions (tenant_id, project_id, original_end_date, extended_end_date, extension_days, reason, penalty_applicable, penalty_per_day_minor, status, created_by)
      VALUES (${ctx.tenantId}, ${id}, ${b.originalEndDate}, ${b.extendedEndDate}, ${b.extensionDays}, ${b.reason}, ${b.penaltyApplicable ?? false}, ${b.penaltyPerDayMinor ?? 0}, ${"requested"}, ${ctx.actorId})
    `);
    return reply.code(201).send({ message: "time extension requested" });
  });

  app.post("/v1/projects/:id/time-extensions/:extId/approve", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PROJ_ROLES);
    const { id, extId } = req.params as { id: string; extId: string };
    await db.execute(sql`
      UPDATE project.project_time_extensions
      SET status = 'approved', approved_by = ${ctx.actorId}, approval_date = CURRENT_DATE
      WHERE id = ${extId} AND tenant_id = ${ctx.tenantId} AND project_id = ${id}
    `);
    return reply.send({ message: "time extension approved" });
  });

  // ─── Penalties / Liquidated Damages ─────────────────────────────────────────

  app.get("/v1/projects/:id/penalties", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = req.params as { id: string };
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
    const { id } = req.params as { id: string };
    const b = req.body as any;
    const total = Number(b.days) * Number(b.ratePerDayMinor);
    await db.execute(sql`
      INSERT INTO project.project_penalties (tenant_id, project_id, contractor_id, penalty_type, from_date, to_date, days, rate_per_day_minor, total_minor, recovered, recovered_from, created_by)
      VALUES (${ctx.tenantId}, ${id}, ${b.contractorId ?? null}, ${b.penaltyType ?? "delay"}, ${b.fromDate}, ${b.toDate}, ${b.days}, ${b.ratePerDayMinor}, ${total}, ${false}, ${b.recoveredFrom ?? null}, ${ctx.actorId})
    `);
    return reply.code(201).send({ message: "penalty levied" });
  });

  // ─── Resource Allocation ────────────────────────────────────────────────────

  app.get("/v1/projects/:id/resources", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = req.params as { id: string };
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
    const { id } = req.params as { id: string };
    const b = req.body as any;
    await db.execute(sql`
      INSERT INTO project.project_resources (tenant_id, project_id, task_id, resource_type, resource_id, resource_name, allocated_hours, daily_rate_minor, from_date, to_date, status)
      VALUES (${ctx.tenantId}, ${id}, ${b.taskId ?? null}, ${b.resourceType ?? "person"}, ${b.resourceId ?? null}, ${b.resourceName}, ${b.allocatedHours ?? null}, ${b.dailyRateMinor ?? 0}, ${b.fromDate ?? null}, ${b.toDate ?? null}, ${"allocated"})
    `);
    return reply.code(201).send({ message: "resource allocated" });
  });

  // ─── Baselines ──────────────────────────────────────────────────────────────

  app.get("/v1/projects/:id/baselines", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = req.params as { id: string };
    const rows = await db.execute(sql`
      SELECT * FROM project.project_baselines
      WHERE tenant_id = ${ctx.tenantId} AND project_id = ${id}
      ORDER BY baseline_no DESC
    `);
    return reply.send({ data: rows });
  });

  app.post("/v1/projects/:id/baselines", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PROJ_ROLES);
    const { id } = req.params as { id: string };
    const b = req.body as any;
    await db.execute(sql`
      INSERT INTO project.project_baselines (tenant_id, project_id, baseline_no, snapshot_date, planned_start, planned_end, planned_cost_minor, milestones_snapshot, created_by)
      VALUES (${ctx.tenantId}, ${id}, ${b.baselineNo ?? 1}, ${b.snapshotDate}, ${b.plannedStart}, ${b.plannedEnd}, ${b.plannedCostMinor}, ${JSON.stringify(b.milestonesSnapshot ?? [])}, ${ctx.actorId})
    `);
    return reply.code(201).send({ message: "baseline created" });
  });

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
