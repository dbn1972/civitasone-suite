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
import { sqlClient } from "../../shared/db.js";
import { withRawTenantGuc } from "@civitasone/db";

const HR_ROLES   = ["hr_admin", "super_admin", "hr_officer"];
const MGR_ROLES  = [...HR_ROLES, "manager", "dept_head"];
const ALL_ROLES  = [...MGR_ROLES, "employee"];
const idParam    = z.object({ id: z.string().uuid() });

function isHr(ctx: { roles: string[] }): boolean {
  return ctx.roles.some((r) => HR_ROLES.includes(r));
}

/**
 * Audit: hrms.development_plans is FORCE ROW LEVEL SECURITY (tenant_isolation_policy,
 * matching every other tenant-scoped table in this schema). Plain sqlPool.query()
 * runs on a pooled connection with no app.tenant_id GUC set, so under hrms_svc
 * (NOBYPASSRLS) the policy fails CLOSED -- confirmed live, empty results with no
 * error, for a request whose own JWT actorId matched a real seeded row exactly.
 * Same bug, same fix as social/routes.ts's identical withTenantGuc (see that
 * file's header for the full story) -- this module never received it. Scoped to
 * just the development-plans handlers this change's frontend fix depends on
 * actually returning real rows; the goals/learning-paths handlers below share
 * the same underlying gap and are flagged separately as a follow-up, not fixed
 * here, to keep this change to what hr/goals's dev-plans section needs.
 *
 * Follow-up: the goals PATCH/DELETE handlers below share this exact gap
 * (hrms.goals is FORCE ROW LEVEL SECURITY too) and have now been wrapped
 * the same way.
 *
 * The learning-paths gaps query (below) used to join `employee.role_requirements` (never existed) and do
 * integer arithmetic on the varchar `assessed_level` (500 in the UAT API sweep, 2026-10-29). It now reads
 * `employee.role_competency_map` and derives numeric levels from each competency's `proficiency_levels`.
 */
function withTenantGuc<T>(
  tenantId: string,
  fn: (pool: {
    query<R = any>(text: string, params?: readonly unknown[]): Promise<{ rows: R[]; rowCount: number }>;
  }) => Promise<T>,
): Promise<T> {
  return withRawTenantGuc(sqlClient, tenantId, async (tx) => {
    const pool = {
      async query<R = any>(text: string, params: readonly unknown[] = []): Promise<{ rows: R[]; rowCount: number }> {
        const result = await tx.unsafe(text, params as unknown as never[]);
        const rows = result as unknown as R[];
        const rowCount = (result as unknown as { count?: number }).count ?? rows.length;
        return { rows, rowCount };
      },
    };
    return fn(pool);
  });
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
    // Static statement: a NULL owner param (HR) disables the owner filter.
    const ownerId = isHr(ctx) ? null : ctx.actorId;
    const { rows: existing } = await withTenantGuc(ctx.tenantId, (pool) => pool.query(
      "SELECT id FROM hrms.goals WHERE id = $1 AND tenant_id = $2 AND ($3::uuid IS NULL OR employee_id = $3::uuid)",
      [id, ctx.tenantId, ownerId],
    ));
    if (!existing[0]) throw new HttpError(404, "NOT_FOUND", "Goal not found");

    const dueDateGiven = body.dueDate !== undefined;
    if (body.title == null && body.description == null && body.status == null && body.progress == null && !dueDateGiven) {
      return reply.send({ updated: false });
    }
    // Static statement: COALESCE keeps a column unchanged when its param is NULL.
    await withTenantGuc(ctx.tenantId, (pool) => pool.query(
      `UPDATE hrms.goals SET updated_at = NOW(),
         title = COALESCE($1, title), description = COALESCE($2, description),
         status = COALESCE($3, status), progress = COALESCE($4, progress),
         due_date = CASE WHEN $5::boolean THEN $6 ELSE due_date END
       WHERE id = $7 AND tenant_id = $8`,
      [body.title ?? null, body.description ?? null, body.status ?? null, body.progress ?? null,
       dueDateGiven, body.dueDate ?? null, id, ctx.tenantId],
    ));
    return reply.send({ updated: true });
  });

  /** DELETE /v1/hrms/goals/:id — HR admin only */
  app.delete("/v1/hrms/goals/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const { rowCount } = await withTenantGuc(ctx.tenantId, (pool) => pool.query(
      `DELETE FROM hrms.goals WHERE id = $1 AND tenant_id = $2`,
      [id, ctx.tenantId],
    ));
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
    await withTenantGuc(ctx.tenantId, (pool) => pool.query(
      `INSERT INTO hrms.development_plans
         (id, tenant_id, employee_id, title, description, type,
          planned_date, duration_days, skill_targeted, priority, status, created_by, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'planned',$11,NOW())`,
      [id, ctx.tenantId, body.employeeId, body.title, body.description ?? null,
       body.type, body.plannedDate, body.durationDays ?? null,
       body.skillTargeted ?? null, body.priority, ctx.actorId],
    ));
    return reply.code(201).send({ data: { id, status: "planned" } });
  });

  /** GET /v1/hrms/development-plans — list (own or all for HR/manager) */
  app.get("/v1/hrms/development-plans", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALL_ROLES);
    const { employeeId } = z.object({ employeeId: z.string().uuid().optional() }).parse(req.query);
    const targetId = isHr(ctx) ? (employeeId ?? null) : ctx.actorId;
    const { rows } = await withTenantGuc(ctx.tenantId, (pool) => pool.query(
      `SELECT dp.id, e.full_name AS employee, dp.title, dp.description, dp.type,
              dp.planned_date AS "plannedDate", dp.duration_days AS "durationDays",
              dp.skill_targeted AS "skillTargeted", dp.priority, dp.status, dp.created_at AS "createdAt"
       FROM hrms.development_plans dp
       JOIN employee.hrms_employees e ON e.id = dp.employee_id AND e.tenant_id = $1
       WHERE dp.tenant_id = $1 ${targetId ? "AND dp.employee_id = $2" : ""}
       ORDER BY dp.planned_date ASC LIMIT 200`,
      targetId ? [ctx.tenantId, targetId] : [ctx.tenantId],
    ));
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

    const completedAtGiven = body.completedAt !== undefined;
    // Static statement: COALESCE keeps a column unchanged when its param is NULL.
    const { rowCount } = await withTenantGuc(ctx.tenantId, (pool) => pool.query(
      `UPDATE hrms.development_plans SET updated_at = NOW(),
         status = COALESCE($1, status),
         completed_at = CASE WHEN $2::boolean THEN $3 ELSE completed_at END,
         notes = COALESCE($4, notes)
       WHERE id = $5 AND tenant_id = $6`,
      [body.status ?? null, completedAtGiven, body.completedAt ?? null, body.notes ?? null, id, ctx.tenantId],
    ));
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
    // Levels are qualitative (employee.competencies.proficiency_levels, ordered low -> high; e.g.
    // beginner < intermediate < advanced < expert). The numeric level is the 1-based position of the
    // level name in that competency's own proficiency_levels array, so no mapping is invented here.
    // Requirement = employee.role_competency_map (highest required level across roles); an
    // un-assessed competency counts as level 0; a competency with no requirement defaults to 3.
    const { rows: gaps } = await withTenantGuc(ctx.tenantId, (pool) => pool.query(
      `WITH lv AS (
         SELECT c.id AS cid, t.lvl, t.ord
         FROM employee.competencies c
         CROSS JOIN LATERAL jsonb_array_elements_text(c.proficiency_levels) WITH ORDINALITY AS t(lvl, ord)
         WHERE c.tenant_id = $1
       ), req AS (
         SELECT rcm.competency_id, MAX(lv.ord) AS ord
         FROM employee.role_competency_map rcm
         JOIN lv ON lv.cid = rcm.competency_id AND lv.lvl = rcm.required_level
         WHERE rcm.tenant_id = $1
         GROUP BY rcm.competency_id
       ), cur AS (
         SELECT DISTINCT ON (sa.competency_id) sa.competency_id, lv.ord
         FROM employee.skill_assessments sa
         JOIN lv ON lv.cid = sa.competency_id AND lv.lvl = sa.assessed_level
         WHERE sa.tenant_id = $1 AND sa.employee_id = $2
         ORDER BY sa.competency_id, sa.assessed_at DESC
       )
       SELECT c.id AS "competencyId", c.name AS skill, c.category,
              COALESCE(cur.ord, 0)::int AS "currentLevel",
              COALESCE(req.ord, 3)::int AS "requiredLevel",
              GREATEST(COALESCE(req.ord, 3) - COALESCE(cur.ord, 0), 0)::int AS gap
       FROM employee.competencies c
       LEFT JOIN cur ON cur.competency_id = c.id
       LEFT JOIN req ON req.competency_id = c.id
       WHERE c.tenant_id = $1
         AND GREATEST(COALESCE(req.ord, 3) - COALESCE(cur.ord, 0), 0) > 0
       ORDER BY gap DESC LIMIT 10`,
      [ctx.tenantId, targetId],
    ));

    const paths: unknown[] = [];
    for (const g of gaps.slice(0, 6)) {
      const { rows: courses } = await withTenantGuc(ctx.tenantId, (pool) => pool.query(
        `SELECT id, code, name, duration_hours AS "durationHours", mandatory_for_roles AS "mandatoryForRoles"
         FROM training.lms_courses
         WHERE tenant_id = $1 AND status = 'active'
           AND (skills_gained::jsonb ? $2 OR name ILIKE '%' || $2 || '%')
         ORDER BY duration_hours ASC LIMIT 3`,
        [ctx.tenantId, g.skill],
      ));
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
