/**
 * Sprint-14: Performance & Development — additional CRUD routes
 *
 * Extends goals (PATCH/DELETE), adds development plans, and learning-path
 * recommendation endpoint (skill-gap → LMS course matching).
 */
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { randomUUID } from "node:crypto";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { sqlPool } from "../../shared/db.js";

const HR_ROLES   = ["hr_admin", "super_admin", "hr_officer"];
const MGR_ROLES  = [...HR_ROLES, "manager", "dept_head"];
const ALL_ROLES  = [...MGR_ROLES, "employee"];
const idParam    = z.object({ id: z.string().uuid() });

function isHr(ctx: { roles: string[] }): boolean {
  return ctx.roles.some((r) => HR_ROLES.includes(r));
}

export async function performanceDevRoutes(app: FastifyInstance): Promise<void> {
  // ── Goals CRUD extensions ──────────────────────────────────────────────────

  /** PATCH /v1/hrms/goals/:id — update title / status / progress / dueDate */
  app.patch("/v1/hrms/goals/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALL_ROLES);
    const { id } = idParam.parse(req.params);
    const body = z.object({
      title:       z.string().min(1).max(200).optional(),
      description: z.string().max(2000).optional(),
      status:      z.enum(["active","on_track","at_risk","behind","achieved","completed"]).optional(),
      progress:    z.number().min(0).max(100).optional(),
      dueDate:     z.string().nullable().optional(),
    }).parse(req.body);

    // HR admins may update any goal; employees only their own
    const ownerClause = isHr(ctx) ? "" : "AND employee_id = $3";
    const checkParams = isHr(ctx) ? [id, ctx.tenantId] : [id, ctx.tenantId, ctx.actorId];
    const { rows: existing } = await sqlPool.query(
      `SELECT id FROM hrms.goals WHERE id = $1 AND tenant_id = $2 ${ownerClause}`,
      checkParams,
    );
    if (!existing[0]) throw new HttpError(404, "NOT_FOUND", "Goal not found");

    const sets: string[] = ["updated_at = NOW()"];
    const vals: unknown[] = [];
    let i = 1;
    if (body.title       != null)      { sets.push(`title = $${i++}`);       vals.push(body.title); }
    if (body.description != null)      { sets.push(`description = $${i++}`); vals.push(body.description); }
    if (body.status      != null)      { sets.push(`status = $${i++}`);      vals.push(body.status); }
    if (body.progress    != null)      { sets.push(`progress = $${i++}`);    vals.push(body.progress); }
    if (body.dueDate     !== undefined){ sets.push(`due_date = $${i++}`);    vals.push(body.dueDate); }
    if (vals.length === 0) return reply.send({ updated: false });
    vals.push(id, ctx.tenantId);
    await sqlPool.query(
      `UPDATE hrms.goals SET ${sets.join(", ")} WHERE id = $${i} AND tenant_id = $${i + 1}`,
      vals,
    );
    return reply.send({ updated: true });
  });

  /** DELETE /v1/hrms/goals/:id — HR admin only */
  app.delete("/v1/hrms/goals/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const { rowCount } = await sqlPool.query(
      `DELETE FROM hrms.goals WHERE id = $1 AND tenant_id = $2`,
      [id, ctx.tenantId],
    );
    if (!rowCount) throw new HttpError(404, "NOT_FOUND", "Goal not found");
    return reply.code(204).send();
  });

  // ── Development Plans ──────────────────────────────────────────────────────

  /** POST /v1/hrms/development-plans — create a planned development activity */
  app.post("/v1/hrms/development-plans", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, MGR_ROLES);
    const body = z.object({
      employeeId:   z.string().uuid(),
      title:        z.string().min(1).max(200),
      description:  z.string().max(2000).optional(),
      type:         z.enum(["training","project","mentoring","self_study","certification","job_rotation","other"]),
      plannedDate:  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD"),
      durationDays: z.number().int().min(1).max(365).optional(),
      skillTargeted:z.string().max(100).optional(),
      priority:     z.enum(["high","medium","low"]).default("medium"),
    }).parse(req.body);

    const id = randomUUID();
    await sqlPool.query(
      `INSERT INTO hrms.development_plans
         (id, tenant_id, employee_id, title, description, type,
          planned_date, duration_days, skill_targeted, priority, status, created_by, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'planned',$11,NOW())`,
      [id, ctx.tenantId, body.employeeId, body.title, body.description ?? null,
       body.type, body.plannedDate, body.durationDays ?? null,
       body.skillTargeted ?? null, body.priority, ctx.actorId],
    );
    return reply.code(201).send({ data: { id, status: "planned" } });
  });

  /** GET /v1/hrms/development-plans — list (own or all for HR/manager) */
  app.get("/v1/hrms/development-plans", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALL_ROLES);
    const { employeeId } = z.object({ employeeId: z.string().uuid().optional() }).parse(req.query);
    const targetId = isHr(ctx) ? (employeeId ?? null) : ctx.actorId;
    const { rows } = await sqlPool.query(
      `SELECT dp.id, e.full_name AS employee, dp.title, dp.description, dp.type,
              dp.planned_date AS "plannedDate", dp.duration_days AS "durationDays",
              dp.skill_targeted AS "skillTargeted", dp.priority, dp.status, dp.created_at AS "createdAt"
       FROM hrms.development_plans dp
       JOIN employee.hrms_employees e ON e.id = dp.employee_id AND e.tenant_id = $1
       WHERE dp.tenant_id = $1 ${targetId ? "AND dp.employee_id = $2" : ""}
       ORDER BY dp.planned_date ASC LIMIT 200`,
      targetId ? [ctx.tenantId, targetId] : [ctx.tenantId],
    );
    return reply.send({ data: rows });
  });

  /** PATCH /v1/hrms/development-plans/:id — update status / notes */
  app.patch("/v1/hrms/development-plans/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, MGR_ROLES);
    const { id } = idParam.parse(req.params);
    const body = z.object({
      status:      z.enum(["planned","in_progress","completed","deferred","cancelled"]).optional(),
      completedAt: z.string().nullable().optional(),
      notes:       z.string().max(2000).optional(),
    }).parse(req.body);

    const sets: string[] = ["updated_at = NOW()"];
    const vals: unknown[] = [];
    let i = 1;
    if (body.status      != null)      { sets.push(`status = $${i++}`);       vals.push(body.status); }
    if (body.completedAt !== undefined) { sets.push(`completed_at = $${i++}`); vals.push(body.completedAt); }
    if (body.notes       != null)      { sets.push(`notes = $${i++}`);        vals.push(body.notes); }
    vals.push(id, ctx.tenantId);
    const { rowCount } = await sqlPool.query(
      `UPDATE hrms.development_plans SET ${sets.join(", ")} WHERE id = $${i} AND tenant_id = $${i + 1}`,
      vals,
    );
    if (!rowCount) throw new HttpError(404, "NOT_FOUND", "Development plan not found");
    return reply.send({ updated: true });
  });

  // ── Learning Paths (skill-gap → LMS course recommendations) ───────────────

  /** GET /v1/hrms/learning-paths?employeeId=<uuid> */
  app.get("/v1/hrms/learning-paths", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALL_ROLES);
    const { employeeId } = z.object({ employeeId: z.string().uuid().optional() }).parse(req.query);
    const targetId = employeeId ?? ctx.actorId;
    if (!isHr(ctx) && targetId !== ctx.actorId)
      throw new HttpError(403, "FORBIDDEN", "Cannot view another employee's learning path");

    // Identify competency gaps
    const { rows: gaps } = await sqlPool.query(
      `SELECT c.id AS "competencyId", c.name AS skill, c.category,
              COALESCE(sa.assessed_level, 0) AS "currentLevel",
              COALESCE(rr.required_level, 3) AS "requiredLevel",
              GREATEST(COALESCE(rr.required_level, 3) - COALESCE(sa.assessed_level, 0), 0) AS gap
       FROM employee.competencies c
       LEFT JOIN employee.skill_assessments sa
         ON sa.competency_id = c.id AND sa.employee_id = $2 AND sa.tenant_id = $1
       LEFT JOIN employee.role_requirements rr
         ON rr.competency_id = c.id AND rr.tenant_id = $1
       WHERE c.tenant_id = $1
         AND GREATEST(COALESCE(rr.required_level,3) - COALESCE(sa.assessed_level,0), 0) > 0
       ORDER BY gap DESC LIMIT 10`,
      [ctx.tenantId, targetId],
    );

    const paths: unknown[] = [];
    for (const g of gaps.slice(0, 6)) {
      const { rows: courses } = await sqlPool.query(
        `SELECT id, code, name, duration_hours AS "durationHours", mandatory_for_roles AS "mandatoryForRoles"
         FROM training.lms_courses
         WHERE tenant_id = $1 AND status = 'active'
           AND (skills_gained::jsonb ? $2 OR name ILIKE '%' || $2 || '%')
         ORDER BY duration_hours ASC LIMIT 3`,
        [ctx.tenantId, g.skill],
      );
      paths.push({
        skillGap:    g.skill,
        gapPoints:   Number(g.gap),
        priority:    Number(g.gap) >= 3 ? "high" : Number(g.gap) >= 2 ? "medium" : "low",
        currentLevel: Number(g.currentLevel),
        requiredLevel: Number(g.requiredLevel),
        programs: courses.map((c) => ({
          id:       c.id,
          code:     c.code,
          name:     c.name,
          duration: `${c.durationHours}h`,
          mode:     (c.mandatoryForRoles as string[])?.length ? "Mandatory" : "Recommended",
          enrollUrl: `/hr/training/lms/${c.id}/enroll`,
        })),
      });
    }

    return reply.send({ data: paths, employeeId: targetId });
  });

  // Error handler
  app.setErrorHandler((err, req, reply) => {
    const cid = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError)  return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId: cid, retryable: false });
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId: cid, retryable: false });
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId: cid, retryable: true });
  });
}
