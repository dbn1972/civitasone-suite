/**
 * World-class gap features — compensation planning, LMS, skills matrix,
 * succession planning, engagement surveys, onboarding, 360° feedback, benefits.
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z, ZodError } from "zod";
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { sqlClient, db } from "../../shared/db.js";
import { resolveEmployeeForActor } from "../employee/actor-link.js";
import * as employeeRepo from "../employee/repo.js";
import { emitAudit } from "../recruitment/audit-emit.js";
import { captureError } from "@civitasone/observability";
import { VIGILANCE_STATUS_GROUPS } from "../disciplinary/state-machine.js";

const HR_ROLES = ["hr_admin", "super_admin", "hr_officer"];
const READER_ROLES = [...HR_ROLES, "manager", "employee"];
const ALL_ROLES = [...HR_ROLES, "manager", "employee"];

/**
 * IDOR fix (audit): GET /v1/hrms/skills/gap-analysis took a client-supplied
 * employeeId with no check against the caller's identity. A bare "employee"
 * caller is forced onto their own linked hrms_employees record (resolved
 * via resolveEmployeeForActor -- NOT ctx.actorId, a different id space; see
 * employee/actor-link.ts). HR and manager roles pass the requested id
 * through unchanged -- this module has no existing "manager scoped to
 * direct reports" precedent of its own, the same judgment call
 * medical/routes.ts's resolveSelfScopedEmployeeId documents. Returns null
 * when a bare-employee caller has no resolvable employee link -- callers
 * MUST treat that as "nothing to show" (fails CLOSED).
 */
async function resolveOwnEmployeeIdIfBareEmployee(
  ctx: RequestContext, req: FastifyRequest, requested: string,
): Promise<string | null> {
  const isPrivileged = [...HR_ROLES, "manager"].some((r) => ctx.roles.includes(r));
  if (isPrivileged) return requested;
  const actorEmp = await resolveEmployeeForActor(ctx.tenantId, ctx.actorId);
  return actorEmp ? actorEmp.id : null;
}

/**
 * Scope resolver for GET /v1/hrms/certifications (CERTIFICATIONS-02) only —
 * deliberately NOT resolveOwnEmployeeIdIfBareEmployee above (that one treats
 * "manager" as fully privileged, an existing precedent this file's
 * skills/work-summaries routes already rely on and which this fix does not
 * touch). Certifications had no scoping at all before this fix, so there is
 * a free choice here, and the campaign's stated target model is used: HR
 * unrestricted (returns null — no filter), manager scoped to self + direct
 * reports, bare employee scoped to self. Returns a concrete (possibly
 * empty) array for non-HR; empty means "authorized for nothing" — callers
 * must respond with an empty list, never fall back to unscoped.
 */
async function resolveCertificationsScope(ctx: RequestContext): Promise<string[] | null> {
  const isHrActor = HR_ROLES.some((r) => ctx.roles.includes(r));
  if (isHrActor) return null;
  const actorEmp = await resolveEmployeeForActor(ctx.tenantId, ctx.actorId);
  if (!actorEmp) return [];
  if (!ctx.roles.includes("manager")) return [actorEmp.id];
  const rows = await sqlClient.begin(async (sql) => {
    await sql.unsafe("SELECT set_config('app.tenant_id', $1, true)", [ctx.tenantId]);
    return sql.unsafe(
      `SELECT id FROM employee.hrms_employees WHERE tenant_id = $1 AND manager_id = $2`,
      [ctx.tenantId, actorEmp.id],
    );
  });
  return [actorEmp.id, ...rows.map((r) => r.id as string)];
}

/**
 * IDOR fix (audit): GET /v1/hrms/skills and GET /v1/hrms/work-summaries were
 * org-wide list dumps with no employee filter at all, exposing every
 * employee's competency/appraisal data to any employee or manager. Unlike
 * resolveOwnEmployeeIdIfBareEmployee above, this scopes BOTH bare
 * "employee" and "manager" callers to their own record (only HR_ROLES is
 * privileged/tenant-wide here) -- these are list-dump endpoints with no
 * existing "manager sees direct reports" precedent, so manager is treated
 * the same as employee rather than the same as HR.
 * Returns: undefined (HR — unrestricted, no filter), a uuid (non-HR,
 * resolved to caller's own hrms_employees.id), or null (non-HR caller with
 * no resolvable employee link — callers MUST return an empty list).
 */
async function resolveOwnEmployeeIdIfNonHr(
  ctx: RequestContext, req: FastifyRequest,
): Promise<string | null | undefined> {
  if (HR_ROLES.some((r) => ctx.roles.includes(r))) return undefined;
  const actorEmp = await resolveEmployeeForActor(ctx.tenantId, ctx.actorId);
  return actorEmp ? actorEmp.id : null;
}

export async function hrmsGapRoutes(app: FastifyInstance): Promise<void> {
  // ─── Gap 1: Compensation Planning ──────────────────────────────────────────
  app.post("/v1/hrms/compensation/plans", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, HR_ROLES);
    const body = z.object({
      name: z.string().min(1).max(200), fy: z.string().regex(/^\d{4}-\d{2}$/),
      budgetMinor: z.number().int().min(0), guidelines: z.record(z.unknown()).optional(),
    }).parse(req.body);
    const id = randomUUID();
    // GUC fix: employee.compensation_plans has FORCE ROW LEVEL SECURITY; sqlPool.query()
    // never sets app.tenant_id, so this silently touched zero rows for every caller.
    // Wrapped in sqlClient.begin() + set_config(), mirroring staffing-plan/onboarding.
    await sqlClient.begin(async (sql) => {
      await sql.unsafe("SELECT set_config('app.tenant_id', $1, true)", [ctx.tenantId]);
      await sql.unsafe(
        `INSERT INTO employee.compensation_plans (id, tenant_id, name, fy, budget_minor, guidelines, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [id, ctx.tenantId, body.name, body.fy, body.budgetMinor, JSON.stringify(body.guidelines ?? {}), ctx.actorId],
      );
    });
    return reply.code(201).send({ data: { id, ...body, status: "draft" } });
  });

  app.get("/v1/hrms/compensation/plans", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, READER_ROLES);
    const rows = await sqlClient.begin(async (sql) => {
      await sql.unsafe("SELECT set_config('app.tenant_id', $1, true)", [ctx.tenantId]);
      return sql.unsafe(
        `SELECT id, name, fy, budget_minor, status, created_at FROM employee.compensation_plans WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 50`, [ctx.tenantId]);
    });
    return reply.send({ data: rows });
  });

  app.post("/v1/hrms/compensation/plans/:id/model", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, HR_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const rows = await sqlClient.begin(async (sql) => {
      await sql.unsafe("SELECT set_config('app.tenant_id', $1, true)", [ctx.tenantId]);
      return sql.unsafe(`SELECT id, budget_minor FROM employee.compensation_plans WHERE id = $1 AND tenant_id = $2`, [id, ctx.tenantId]);
    }) as unknown as Array<{ id: string; budget_minor: number }>;
    if (!rows[0]) throw new HttpError(404, "NOT_FOUND", "plan not found");
    // Simplified model: 10% average increment recommendation
    return reply.send({ data: { planId: id, model: "average_10pct", recommendations: [] } });
  });

  // ─── Gap 2: LMS ────────────────────────────────────────────────────────────
  app.post("/v1/hrms/lms/courses", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, HR_ROLES);
    const body = z.object({
      code: z.string().min(1).max(32), name: z.string().min(1).max(200),
      description: z.string().max(2000).optional(),
      durationHours: z.number().int().min(1).max(1000).default(1),
      skillsGained: z.array(z.string()).default([]),
      mandatoryForRoles: z.array(z.string()).default([]),
    }).parse(req.body);
    const id = randomUUID();
    await sqlClient.begin(async (sql) => {
      await sql.unsafe("SELECT set_config('app.tenant_id', $1, true)", [ctx.tenantId]);
      await sql.unsafe(
        `INSERT INTO training.lms_courses (id, tenant_id, code, name, description, duration_hours, skills_gained, mandatory_for_roles, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [id, ctx.tenantId, body.code, body.name, body.description ?? null, body.durationHours, JSON.stringify(body.skillsGained), JSON.stringify(body.mandatoryForRoles), ctx.actorId],
      );
    });
    return reply.code(201).send({ data: { id, ...body, status: "active" } });
  });

  app.get("/v1/hrms/lms/courses", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ALL_ROLES);
    const rows = await sqlClient.begin(async (sql) => {
      await sql.unsafe("SELECT set_config('app.tenant_id', $1, true)", [ctx.tenantId]);
      return sql.unsafe(`SELECT id, code, name, duration_hours, skills_gained, mandatory_for_roles, status FROM training.lms_courses WHERE tenant_id = $1 AND status = 'active' ORDER BY name LIMIT 100`, [ctx.tenantId]);
    });
    return reply.send({ data: rows });
  });

  app.post("/v1/hrms/lms/courses/:id/enroll", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ALL_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({ employeeId: z.string().uuid() }).parse(req.body);
    const eid = randomUUID();
    await sqlClient.begin(async (sql) => {
      await sql.unsafe("SELECT set_config('app.tenant_id', $1, true)", [ctx.tenantId]);
      await sql.unsafe(
        `INSERT INTO training.lms_enrollments (id, tenant_id, course_id, employee_id) VALUES ($1,$2,$3,$4) ON CONFLICT (tenant_id, course_id, employee_id) DO NOTHING`,
        [eid, ctx.tenantId, id, body.employeeId]);
    });
    return reply.code(201).send({ data: { id: eid, courseId: id, employeeId: body.employeeId, status: "enrolled" } });
  });

  app.post("/v1/hrms/lms/enrollments/:id/complete", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, HR_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({ score: z.number().min(0).max(100).optional() }).parse(req.body ?? {});
    await sqlClient.begin(async (sql) => {
      await sql.unsafe("SELECT set_config('app.tenant_id', $1, true)", [ctx.tenantId]);
      await sql.unsafe(`UPDATE training.lms_enrollments SET status = 'completed', completed_at = NOW(), score = $1 WHERE id = $2 AND tenant_id = $3`, [body.score ?? null, id, ctx.tenantId]);
    });
    return reply.send({ data: { id, status: "completed" } });
  });

  app.get("/v1/hrms/lms/my-learning", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ALL_ROLES);
    const rows = await sqlClient.begin(async (sql) => {
      await sql.unsafe("SELECT set_config('app.tenant_id', $1, true)", [ctx.tenantId]);
      return sql.unsafe(
        `SELECT e.id, c.name, c.code, e.status, e.enrolled_at, e.completed_at, e.score FROM training.lms_enrollments e JOIN training.lms_courses c ON c.id = e.course_id WHERE e.tenant_id = $1 AND e.employee_id = $2 ORDER BY e.enrolled_at DESC LIMIT 50`,
        [ctx.tenantId, ctx.actorId]);
    });
    return reply.send({ data: rows });
  });

  app.get("/v1/hrms/lms/compliance", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, HR_ROLES);
    const rows = await sqlClient.begin(async (sql) => {
      await sql.unsafe("SELECT set_config('app.tenant_id', $1, true)", [ctx.tenantId]);
      return sql.unsafe(
        `SELECT c.id, c.code, c.name, c.mandatory_for_roles, COUNT(e.id) FILTER (WHERE e.status = 'completed') AS completed_count, COUNT(e.id) AS total_enrolled FROM training.lms_courses c LEFT JOIN training.lms_enrollments e ON e.course_id = c.id AND e.tenant_id = c.tenant_id WHERE c.tenant_id = $1 AND c.mandatory_for_roles != '[]'::jsonb GROUP BY c.id ORDER BY c.name`, [ctx.tenantId]);
    });
    return reply.send({ data: rows });
  });

  // ─── Gap 3: Skills Matrix ──────────────────────────────────────────────────
  app.post("/v1/hrms/skills/competencies", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, HR_ROLES);
    const body = z.object({ name: z.string().min(1).max(128), category: z.string().max(64).default("technical"), proficiencyLevels: z.array(z.string()).default(["beginner","intermediate","advanced","expert"]) }).parse(req.body);
    const id = randomUUID();
    await sqlClient.begin(async (sql) => {
      await sql.unsafe("SELECT set_config('app.tenant_id', $1, true)", [ctx.tenantId]);
      await sql.unsafe(`INSERT INTO employee.competencies (id, tenant_id, name, category, proficiency_levels, created_by) VALUES ($1,$2,$3,$4,$5,$6)`, [id, ctx.tenantId, body.name, body.category, JSON.stringify(body.proficiencyLevels), ctx.actorId]);
    });
    return reply.code(201).send({ data: { id, ...body } });
  });

  app.post("/v1/hrms/skills/role-matrix", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, HR_ROLES);
    const body = z.object({ roleRef: z.string().max(128), competencyId: z.string().uuid(), requiredLevel: z.string().max(32) }).parse(req.body);
    const id = randomUUID();
    await sqlClient.begin(async (sql) => {
      await sql.unsafe("SELECT set_config('app.tenant_id', $1, true)", [ctx.tenantId]);
      await sql.unsafe(`INSERT INTO employee.role_competency_map (id, tenant_id, role_ref, competency_id, required_level) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (tenant_id, role_ref, competency_id) DO UPDATE SET required_level = EXCLUDED.required_level`, [id, ctx.tenantId, body.roleRef, body.competencyId, body.requiredLevel]);
    });
    return reply.code(201).send({ data: { id, ...body } });
  });

  app.post("/v1/hrms/skills/assessments", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, HR_ROLES);
    // GAP-HR-SKILLS-03: constrained to the vocabulary the web matrix actually
    // renders (beginner/intermediate/advanced/expert); a free string let a
    // manual POST invent a level ("proficient") the UI could never map to a
    // dot count.
    const body = z.object({ employeeId: z.string().uuid(), competencyId: z.string().uuid(), assessedLevel: z.enum(["beginner", "intermediate", "advanced", "expert"]), notes: z.string().max(512).optional() }).parse(req.body);
    const id = randomUUID();
    await sqlClient.begin(async (sql) => {
      await sql.unsafe("SELECT set_config('app.tenant_id', $1, true)", [ctx.tenantId]);
      await sql.unsafe(`INSERT INTO employee.skill_assessments (id, tenant_id, employee_id, competency_id, assessed_level, assessed_by, notes) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [id, ctx.tenantId, body.employeeId, body.competencyId, body.assessedLevel, ctx.actorId, body.notes ?? null]);
    });
    return reply.code(201).send({ data: { id, ...body } });
  });

  app.get("/v1/hrms/skills/gap-analysis", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ALL_ROLES);
    const q = z.object({ employeeId: z.string().uuid() }).parse(req.query);
    const employeeId = await resolveOwnEmployeeIdIfBareEmployee(ctx, req, q.employeeId);
    if (employeeId === null) return reply.send({ data: [] });
    const rows = await sqlClient.begin(async (sql) => {
      await sql.unsafe("SELECT set_config('app.tenant_id', $1, true)", [ctx.tenantId]);
      return sql.unsafe(
        `SELECT c.name AS competency, rcm.required_level, COALESCE(sa.assessed_level, 'not_assessed') AS actual_level FROM employee.role_competency_map rcm JOIN employee.competencies c ON c.id = rcm.competency_id LEFT JOIN employee.skill_assessments sa ON sa.competency_id = rcm.competency_id AND sa.employee_id = $2 AND sa.tenant_id = $1 WHERE rcm.tenant_id = $1 ORDER BY c.name`, [ctx.tenantId, employeeId]);
    });
    return reply.send({ data: rows });
  });

  app.get("/v1/hrms/skills/team-heatmap", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, HR_ROLES);
    const q = z.object({ departmentId: z.string().uuid().optional() }).parse(req.query);
    const rows = await sqlClient.begin(async (sql) => {
      await sql.unsafe("SELECT set_config('app.tenant_id', $1, true)", [ctx.tenantId]);
      return sql.unsafe(
        `SELECT c.name AS competency, sa.assessed_level, COUNT(*) AS count FROM employee.skill_assessments sa JOIN employee.competencies c ON c.id = sa.competency_id WHERE sa.tenant_id = $1 GROUP BY c.name, sa.assessed_level ORDER BY c.name`, [ctx.tenantId]);
    });
    return reply.send({ data: rows });
  });

  // ─── Gap 4: Succession Planning ───────────────────────────────────────────
  app.post("/v1/hrms/succession/critical-roles", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, HR_ROLES);
    const body = z.object({ roleRef: z.string().max(128), departmentId: z.string().uuid().optional() }).parse(req.body);
    const id = randomUUID();
    await sqlClient.begin(async (sql) => {
      await sql.unsafe("SELECT set_config('app.tenant_id', $1, true)", [ctx.tenantId]);
      // GAP-HR-SUCCESSION-03: is_critical already defaults to TRUE at the
      // schema level (employee.succession_plans, migration 0033) and this is
      // the only place a plan is ever created, so this was not actually
      // reachable as false before -- set explicitly anyway so the intent is
      // visible at the write site and the column's meaning can't silently
      // drift if a future insert path is added. The real fix for this GAP
      // id is below: the pipeline query previously had no is_critical
      // filter at all while the risk query already did, so the two could
      // in principle disagree; both now filter identically.
      await sql.unsafe(`INSERT INTO employee.succession_plans (id, tenant_id, role_ref, department_id, is_critical, created_by) VALUES ($1,$2,$3,$4,true,$5) ON CONFLICT (tenant_id, role_ref) DO NOTHING`, [id, ctx.tenantId, body.roleRef, body.departmentId ?? null, ctx.actorId]);
    });
    return reply.code(201).send({ data: { id, roleRef: body.roleRef, isCritical: true } });
  });

  app.post("/v1/hrms/succession/nominees", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, HR_ROLES);
    const body = z.object({ planId: z.string().uuid(), employeeId: z.string().uuid(), readiness: z.enum(["now","1yr","2yr","3yr"]).default("1yr"), developmentPlan: z.string().max(2000).optional() }).parse(req.body);
    const id = randomUUID();
    await sqlClient.begin(async (sql) => {
      await sql.unsafe("SELECT set_config('app.tenant_id', $1, true)", [ctx.tenantId]);
      await sql.unsafe(`INSERT INTO employee.succession_nominees (id, tenant_id, plan_id, employee_id, readiness, development_plan) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (tenant_id, plan_id, employee_id) DO UPDATE SET readiness = EXCLUDED.readiness, development_plan = EXCLUDED.development_plan`, [id, ctx.tenantId, body.planId, body.employeeId, body.readiness, body.developmentPlan ?? null]);
    });
    return reply.code(201).send({ data: { id, ...body } });
  });

  // GAP-HR-SUCCESSION-03: single source of truth for the API's readiness
  // vocabulary (now/1yr/2yr/3yr) -> the UI's three-band model. The item's
  // own stated default (fix step 1) puts "2yr" in the same band as "1yr"
  // ("one_two_years"), which is what this maps.
  function mapReadiness(apiReadiness: string): "ready_now" | "one_two_years" | "three_five_years" {
    if (apiReadiness === "now") return "ready_now";
    if (apiReadiness === "1yr" || apiReadiness === "2yr") return "one_two_years";
    return "three_five_years";
  }

  app.get("/v1/hrms/succession/pipeline", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, HR_ROLES);
    const [roleRows, nomineeRows] = await sqlClient.begin(async (sql) => {
      await sql.unsafe("SELECT set_config('app.tenant_id', $1, true)", [ctx.tenantId]);
      const roles = await sql.unsafe(`
        SELECT sp.id AS "planId", sp.role_ref, sp.department_id, d.name AS department,
               COUNT(sn.id) AS nominee_count, COUNT(sn.id) FILTER (WHERE sn.readiness = 'now') AS ready_now
        FROM employee.succession_plans sp
        LEFT JOIN employee.succession_nominees sn ON sn.plan_id = sp.id AND sn.tenant_id = sp.tenant_id
        LEFT JOIN employee.hrms_departments d ON d.id = sp.department_id AND d.tenant_id = sp.tenant_id
        WHERE sp.tenant_id = $1 AND sp.is_critical = true
        GROUP BY sp.id, sp.role_ref, sp.department_id, d.name
        ORDER BY sp.role_ref
      `, [ctx.tenantId]);
      // GAP-HR-SUCCESSION-01: real per-nominee rows -- the pipeline endpoint
      // never returned names/readiness per nominee at all, only aggregate
      // counts, so the web page invented placeholder "Nominee N" people to
      // have something to render.
      const nominees = await sql.unsafe(`
        SELECT sp.id AS "planId", sn.employee_id AS "employeeId", e.full_name AS name,
               sn.readiness, sn.development_plan AS "developmentPlan"
        FROM employee.succession_plans sp
        JOIN employee.succession_nominees sn ON sn.plan_id = sp.id AND sn.tenant_id = sp.tenant_id
        JOIN employee.hrms_employees e ON e.id = sn.employee_id AND e.tenant_id = sp.tenant_id
        WHERE sp.tenant_id = $1 AND sp.is_critical = true
      `, [ctx.tenantId]);
      return [roles, nominees] as const;
    });
    const byPlan = new Map<string, Array<{ employeeId: string; name: string; readiness: string; developmentPlan: string | null }>>();
    for (const n of nomineeRows) {
      const list = byPlan.get(n.planId as string) ?? [];
      list.push(n as unknown as { employeeId: string; name: string; readiness: string; developmentPlan: string | null });
      byPlan.set(n.planId as string, list);
    }
    const data = roleRows.map((r) => {
      const readyNow = Number(r.ready_now ?? 0);
      // GAP-HR-SUCCESSION-03: computed from real data instead of a
      // ready_now===0 ? high : medium default that could never produce
      // "low" (the item's own stated rule).
      const riskLevel = readyNow === 0 ? "high" : readyNow === 1 ? "medium" : "low";
      const successors = (byPlan.get(r.planId as string) ?? []).map((n) => ({
        employeeId: n.employeeId,
        name: n.name,
        readiness: mapReadiness(n.readiness),
        developmentPlan: n.developmentPlan ?? undefined,
      }));
      return {
        planId: r.planId,
        role_ref: r.role_ref,
        department_id: r.department_id,
        department: r.department ?? undefined,
        nominee_count: r.nominee_count,
        ready_now: r.ready_now,
        riskLevel,
        successors,
      };
    });
    return reply.send({ data });
  });

  app.get("/v1/hrms/succession/risk", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, HR_ROLES);
    const rows = await sqlClient.begin(async (sql) => {
      await sql.unsafe("SELECT set_config('app.tenant_id', $1, true)", [ctx.tenantId]);
      // GAP-HR-SUCCESSION-02: department NAME, not the raw department_id
      // UUID the web page was falling back to display.
      return sql.unsafe(
        `SELECT sp.role_ref, sp.department_id, d.name AS department
         FROM employee.succession_plans sp
         LEFT JOIN employee.succession_nominees sn ON sn.plan_id = sp.id AND sn.tenant_id = sp.tenant_id AND sn.readiness = 'now'
         LEFT JOIN employee.hrms_departments d ON d.id = sp.department_id AND d.tenant_id = sp.tenant_id
         WHERE sp.tenant_id = $1 AND sp.is_critical = true
         GROUP BY sp.role_ref, sp.department_id, d.name
         HAVING COUNT(sn.id) = 0`, [ctx.tenantId]);
    });
    return reply.send({ data: rows });
  });

  // ─── Gap 5: Engagement Surveys ─────────────────────────────────────────────
  app.post("/v1/hrms/engagement/surveys", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, HR_ROLES);
    const body = z.object({ title: z.string().min(1).max(200), questions: z.array(z.object({ text: z.string(), type: z.enum(["rating","text","nps"]).default("rating") })).min(1).max(50), isAnonymous: z.boolean().default(true), audience: z.record(z.unknown()).optional() }).parse(req.body);
    const id = randomUUID();
    await sqlClient.begin(async (sql) => {
      await sql.unsafe("SELECT set_config('app.tenant_id', $1, true)", [ctx.tenantId]);
      await sql.unsafe(`INSERT INTO employee.surveys (id, tenant_id, title, questions, is_anonymous, audience, status, created_by) VALUES ($1,$2,$3,$4,$5,$6,'active',$7)`, [id, ctx.tenantId, body.title, JSON.stringify(body.questions), body.isAnonymous, JSON.stringify(body.audience ?? {}), ctx.actorId]);
    });
    return reply.code(201).send({ data: { id, title: body.title, status: "active" } });
  });

  app.post("/v1/hrms/engagement/surveys/:id/respond", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ALL_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({ answers: z.array(z.unknown()).min(1), enpsScore: z.number().int().min(0).max(10).optional() }).parse(req.body);
    const rid = randomUUID();
    await sqlClient.begin(async (sql) => {
      await sql.unsafe("SELECT set_config('app.tenant_id', $1, true)", [ctx.tenantId]);
      await sql.unsafe(`INSERT INTO employee.survey_responses (id, tenant_id, survey_id, answers, enps_score) VALUES ($1,$2,$3,$4,$5)`, [rid, ctx.tenantId, id, JSON.stringify(body.answers), body.enpsScore ?? null]);
    });
    return reply.code(201).send({ data: { id: rid, surveyId: id, submitted: true } });
  });

  app.get("/v1/hrms/engagement/surveys/:id/results", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, HR_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const rows = await sqlClient.begin(async (sql) => {
      await sql.unsafe("SELECT set_config('app.tenant_id', $1, true)", [ctx.tenantId]);
      return sql.unsafe(`SELECT COUNT(*) AS response_count, AVG(enps_score)::numeric(4,2) AS avg_enps FROM employee.survey_responses WHERE tenant_id = $1 AND survey_id = $2`, [ctx.tenantId, id]);
    }) as unknown as Array<{ response_count: string; avg_enps: string | null }>;
    return reply.send({ data: { surveyId: id, responseCount: Number(rows[0]?.response_count ?? 0), avgEnps: rows[0]?.avg_enps ?? null } });
  });

  app.get("/v1/hrms/engagement/eNPS", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, HR_ROLES);
    const rows = await sqlClient.begin(async (sql) => {
      await sql.unsafe("SELECT set_config('app.tenant_id', $1, true)", [ctx.tenantId]);
      return sql.unsafe(
        `SELECT COUNT(*) FILTER (WHERE enps_score >= 9) AS promoters, COUNT(*) FILTER (WHERE enps_score <= 6) AS detractors, COUNT(*) AS total FROM employee.survey_responses WHERE tenant_id = $1 AND enps_score IS NOT NULL`, [ctx.tenantId]);
    }) as unknown as Array<{ promoters: string; detractors: string; total: string }>;
    const r = rows[0] ?? { promoters: 0, detractors: 0, total: 0 };
    const total = Number(r.total);
    const enps = total > 0 ? Math.round(((Number(r.promoters) - Number(r.detractors)) / total) * 100) : 0;
    return reply.send({ data: { enps, promoters: Number(r.promoters), detractors: Number(r.detractors), total } });
  });

  // ─── Gap 6: Onboarding ────────────────────────────────────────────────────
  app.post("/v1/hrms/onboarding/templates", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, HR_ROLES);
    const body = z.object({ name: z.string().min(1).max(128), steps: z.array(z.object({ title: z.string(), owner: z.string().optional(), dueDays: z.number().int().optional() })).min(1).max(50) }).parse(req.body);
    const id = randomUUID();
    // GUC fix: same bug as the sibling steps/complete route below (see its
    // comment) — employee.onboarding_templates has FORCE ROW LEVEL SECURITY
    // and sqlPool.query() never set app.tenant_id. That fix's own comment
    // flagged this route as "consequently also non-functional today" but
    // out of scope for its ownership-focused PR; fixed here.
    await sqlClient.begin(async (sql) => {
      await sql.unsafe("SELECT set_config('app.tenant_id', $1, true)", [ctx.tenantId]);
      await sql.unsafe(`INSERT INTO employee.onboarding_templates (id, tenant_id, name, steps, created_by) VALUES ($1,$2,$3,$4,$5)`, [id, ctx.tenantId, body.name, JSON.stringify(body.steps), ctx.actorId]);
    });
    return reply.code(201).send({ data: { id, ...body, status: "active" } });
  });

  app.get("/v1/hrms/onboarding/active", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, HR_ROLES);
    // GUC fix: same as POST .../onboarding/templates above.
    const rows = await sqlClient.begin(async (sql) => {
      await sql.unsafe("SELECT set_config('app.tenant_id', $1, true)", [ctx.tenantId]);
      return sql.unsafe(`SELECT oi.id, oi.employee_id, ot.name AS template_name, oi.completion_pct, oi.status, oi.created_at FROM employee.onboarding_instances oi JOIN employee.onboarding_templates ot ON ot.id = oi.template_id WHERE oi.tenant_id = $1 AND oi.status = 'active' ORDER BY oi.created_at DESC LIMIT 100`, [ctx.tenantId]);
    });
    return reply.send({ data: rows });
  });

  /**
   * IDOR fix (audit): "same flat-role, no-ownership pattern as disciplinary,
   * on a different table" -- ALL_ROLES (which includes bare "employee") could
   * complete a step on ANY onboarding instance by guessing/enumerating its
   * uuid; nothing compared the instance's own employee_id to the caller.
   * Mirrors this file's OWN established precedent (resolveOwnEmployeeIdIfBareEmployee
   * above): HR + manager stay privileged/tenant-wide (this module has no
   * "manager scoped to direct reports" precedent of its own), a bare
   * "employee" caller must be the instance's own employee (resolved via
   * resolveEmployeeForActor -- NOT ctx.actorId, a different id space), and an
   * unresolvable/mismatched actor gets 404 (not 403) so the check does not
   * leak whether a given instance id exists, the same single-record-lookup
   * rationale apar/routes.ts's assertReadable documents.
   *
   * GUC fix (found while making the ownership check above reachable at all):
   * employee.onboarding_instances has FORCE ROW LEVEL SECURITY
   * (0123_rls_completeness.sql), but sqlPool.query() never sets app.tenant_id
   * -- shared/db.ts's sqlPool is a bare wrapper over sqlClient.unsafe(); only
   * the Drizzle `db` export goes through wrapWithTenantGuc. Verified directly
   * against a real Postgres instance: an INSERT/SELECT through sqlPool.query
   * on a FORCE RLS table is rejected/returns zero rows for every caller,
   * privileged or not, regardless of whether the target row exists -- this
   * route (as it stood) could not have completed a step for ANYONE, so the
   * ownership check just added could never have been exercised. Wrapped in
   * sqlClient.begin() + set_config() -- the same fix already applied to the
   * staffing-plan route below (see its own comment on why set_config(), not
   * `SET`, is required with a bind parameter). The sibling onboarding routes
   * (POST .../onboarding/templates, GET .../onboarding/active) have this same
   * gap and are consequently also non-functional today; left alone here as
   * out of scope for this ownership-focused fix.
   */
  app.post("/v1/hrms/onboarding/:id/steps/:stepIdx/complete", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ALL_ROLES);
    const { id, stepIdx } = z.object({ id: z.string().uuid(), stepIdx: z.coerce.number().int().min(0) }).parse(req.params);
    const isPrivileged = [...HR_ROLES, "manager"].some((r) => ctx.roles.includes(r));
    const actorEmp = isPrivileged
      ? null
      : await resolveEmployeeForActor(ctx.tenantId, ctx.actorId);
    const outcome = await sqlClient.begin(async (sql) => {
      await sql.unsafe("SELECT set_config('app.tenant_id', $1, true)", [ctx.tenantId]);
      const rows = (await sql.unsafe(
        `SELECT steps, employee_id FROM employee.onboarding_instances WHERE id = $1 AND tenant_id = $2`,
        [id, ctx.tenantId],
      )) as unknown as Array<{ steps: Array<Record<string, unknown>>; employee_id: string }>;
      const row = rows[0];
      if (!row) return null;
      if (!isPrivileged && (!actorEmp || actorEmp.id !== row.employee_id)) return null;
      const steps = row.steps;
      if (stepIdx >= steps.length) throw new HttpError(400, "INVALID_STEP", "step index out of range");
      steps[stepIdx] = { ...steps[stepIdx], completed: true, completedAt: new Date().toISOString() };
      const completedCount = steps.filter((s: Record<string, unknown>) => s.completed).length;
      const pct = Math.round((completedCount / steps.length) * 100);
      const status = pct === 100 ? "completed" : "active";
      await sql.unsafe(
        `UPDATE employee.onboarding_instances SET steps = $1, completion_pct = $2, status = $3 WHERE id = $4 AND tenant_id = $5`,
        [JSON.stringify(steps), pct, status, id, ctx.tenantId],
      );
      return { stepIdx, completionPct: pct, status };
    });
    if (!outcome) throw new HttpError(404, "NOT_FOUND", "onboarding instance not found");
    return reply.send({ data: { id, ...outcome } });
  });

  // ─── Gap 7: 360° Feedback ─────────────────────────────────────────────────
  app.post("/v1/hrms/feedback/cycles", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, HR_ROLES);
    const body = z.object({ name: z.string().min(1).max(200), questions: z.array(z.object({ text: z.string(), maxScore: z.number().int().default(5) })).min(1).max(30), raterGroups: z.array(z.string()).default(["self","manager","peer","report"]) }).parse(req.body);
    const id = randomUUID();
    await sqlClient.begin(async (sql) => {
      await sql.unsafe("SELECT set_config('app.tenant_id', $1, true)", [ctx.tenantId]);
      await sql.unsafe(`INSERT INTO employee.feedback_cycles (id, tenant_id, name, questions, rater_groups, status, created_by) VALUES ($1,$2,$3,$4,$5,'active',$6)`, [id, ctx.tenantId, body.name, JSON.stringify(body.questions), JSON.stringify(body.raterGroups), ctx.actorId]);
    });
    return reply.code(201).send({ data: { id, name: body.name, status: "active" } });
  });

  /**
   * IDOR/gaming fix (audit): any employee could nominate who rates a
   * colleague -- there was no check the caller is authorized to nominate
   * raters for this cycle/employee. Restricted to HR or the target
   * employee's actual people-manager (hrms_employees.managerId -- the same
   * reporting-line FK employee/routes.ts's "isManagerOfTarget" check and
   * apar/routes.ts's stage-ownership resolution already use for this
   * relationship).
   */
  app.post("/v1/hrms/feedback/cycles/:id/nominate-raters", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ALL_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({ employeeId: z.string().uuid(), raters: z.array(z.object({ raterId: z.string().uuid(), raterGroup: z.string().max(32) })).min(1).max(20) }).parse(req.body);

    if (!HR_ROLES.some((r) => ctx.roles.includes(r))) {
      const actorEmp = await resolveEmployeeForActor(ctx.tenantId, ctx.actorId);
      const target = await employeeRepo.findById(body.employeeId, ctx.tenantId);
      const isManagerOfTarget = actorEmp != null && target != null && target.managerId === actorEmp.id;
      if (!isManagerOfTarget) {
        throw new HttpError(403, "FORBIDDEN", "only HR or the employee's manager may nominate raters for this feedback cycle");
      }
    }

    await sqlClient.begin(async (sql) => {
      await sql.unsafe("SELECT set_config('app.tenant_id', $1, true)", [ctx.tenantId]);
      for (const r of body.raters) {
        const nid = randomUUID();
        await sql.unsafe(`INSERT INTO employee.feedback_nominations (id, tenant_id, cycle_id, employee_id, rater_id, rater_group) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (tenant_id, cycle_id, employee_id, rater_id) DO NOTHING`, [nid, ctx.tenantId, id, body.employeeId, r.raterId, r.raterGroup]);
      }
    });
    return reply.code(201).send({ data: { cycleId: id, employeeId: body.employeeId, ratersAdded: body.raters.length } });
  });

  /**
   * Gaming fix (audit): the caller could self-attribute raterGroup (e.g.
   * "manager") and submit fabricated 360 scores about anyone -- there was
   * no check the caller is an actually-nominated rater for the cycle/
   * employee in question. Now requires a matching row in
   * employee.feedback_nominations (rater_id = the caller's OWN resolved
   * hrms_employees.id, via resolveEmployeeForActor) and derives raterGroup
   * from THAT nomination row server-side -- the client-supplied
   * body.raterGroup is no longer trusted at all.
   */
  app.post("/v1/hrms/feedback/responses", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ALL_ROLES);
    const body = z.object({ cycleId: z.string().uuid(), employeeId: z.string().uuid(), raterGroup: z.string().max(32), scores: z.record(z.number()), comments: z.string().max(2000).optional() }).parse(req.body);

    const actorEmp = await resolveEmployeeForActor(ctx.tenantId, ctx.actorId);
    if (!actorEmp) {
      throw new HttpError(403, "FORBIDDEN", "no linked employee record for this actor");
    }
    const id = randomUUID();
    // GUC fix: employee.feedback_nominations/_responses have FORCE ROW LEVEL
    // SECURITY; sqlPool.query() never set app.tenant_id. The nomination
    // lookup (authorization) and the response insert share one transaction/
    // GUC, mirroring the onboarding step-complete route's read-then-write
    // pattern — the NOT_NOMINATED rejection is thrown from inside the
    // callback, same as that route's INVALID_STEP throw.
    await sqlClient.begin(async (sql) => {
      await sql.unsafe("SELECT set_config('app.tenant_id', $1, true)", [ctx.tenantId]);
      const nomination = (await sql.unsafe(
        `SELECT rater_group FROM employee.feedback_nominations WHERE tenant_id = $1 AND cycle_id = $2 AND employee_id = $3 AND rater_id = $4`,
        [ctx.tenantId, body.cycleId, body.employeeId, actorEmp.id],
      )) as unknown as Array<{ rater_group: string }>;
      if (nomination.length === 0) {
        throw new HttpError(403, "NOT_NOMINATED", "caller is not a nominated rater for this employee/cycle");
      }
      const raterGroup = nomination[0]!.rater_group; // server-derived — body.raterGroup is never trusted
      await sql.unsafe(`INSERT INTO employee.feedback_responses (id, tenant_id, cycle_id, employee_id, rater_group, scores, comments) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [id, ctx.tenantId, body.cycleId, body.employeeId, raterGroup, JSON.stringify(body.scores), body.comments ?? null]);
    });
    return reply.code(201).send({ data: { id, submitted: true } });
  });

  app.get("/v1/hrms/feedback/cycles/:id/report", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, HR_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const q = z.object({ employeeId: z.string().uuid() }).parse(req.query);
    const rows = await sqlClient.begin(async (sql) => {
      await sql.unsafe("SELECT set_config('app.tenant_id', $1, true)", [ctx.tenantId]);
      return sql.unsafe(`SELECT rater_group, scores FROM employee.feedback_responses WHERE tenant_id = $1 AND cycle_id = $2 AND employee_id = $3`, [ctx.tenantId, id, q.employeeId]);
    }) as unknown as Array<{ rater_group: string; scores: Record<string, number> }>;
    // Aggregate by rater group
    const grouped: Record<string, { count: number; avgScores: Record<string, number> }> = {};
    for (const r of rows) {
      const g = grouped[r.rater_group] ?? { count: 0, avgScores: {} };
      g.count++;
      for (const [k, v] of Object.entries(r.scores)) { g.avgScores[k] = (g.avgScores[k] ?? 0) + v; }
      grouped[r.rater_group] = g;
    }
    for (const g of Object.values(grouped)) { for (const k of Object.keys(g.avgScores)) { g.avgScores[k] = Math.round((g.avgScores[k]! / g.count) * 100) / 100; } }
    return reply.send({ data: { cycleId: id, employeeId: q.employeeId, byRaterGroup: grouped } });
  });

  // ─── Gap 8: Benefits Administration ───────────────────────────────────────
  app.post("/v1/hrms/benefits/plans", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, HR_ROLES);
    const body = z.object({ name: z.string().min(1).max(128), fy: z.string().regex(/^\d{4}-\d{2}$/), flexBudgetMinor: z.number().int().min(0), components: z.array(z.object({ name: z.string(), maxMinor: z.number().int(), taxExempt: z.boolean().default(false) })).min(1).max(20) }).parse(req.body);
    const id = randomUUID();
    await sqlClient.begin(async (sql) => {
      await sql.unsafe("SELECT set_config('app.tenant_id', $1, true)", [ctx.tenantId]);
      await sql.unsafe(`INSERT INTO employee.benefit_plans (id, tenant_id, name, fy, flex_budget_minor, components, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [id, ctx.tenantId, body.name, body.fy, body.flexBudgetMinor, JSON.stringify(body.components), ctx.actorId]);
    });
    return reply.code(201).send({ data: { id, ...body, status: "active" } });
  });

  // GAP-HR-BENEFITS-02: list route the web app needs to drive an election
  // form (plan name/fy/components) -- POST existed above with nothing to
  // read it back with, so no page could ever offer "make an election".
  // ALL_ROLES (not HR_ROLES): every employee needs to see plans to elect
  // into one, same role scope as the my-elections/elections routes below.
  app.get("/v1/hrms/benefits/plans", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ALL_ROLES);
    const rows = await sqlClient.begin(async (sql) => {
      await sql.unsafe("SELECT set_config('app.tenant_id', $1, true)", [ctx.tenantId]);
      return sql.unsafe(`SELECT id, name, fy, components FROM employee.benefit_plans WHERE tenant_id = $1 ORDER BY fy DESC, name ASC`, [ctx.tenantId]);
    });
    return reply.send({ data: rows });
  });

  app.post("/v1/hrms/benefits/elections", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ALL_ROLES);
    const body = z.object({ planId: z.string().uuid(), fy: z.string().regex(/^\d{4}-\d{2}$/), elections: z.array(z.object({ component: z.string(), electedMinor: z.number().int().min(0) })).min(1) }).parse(req.body);
    const total = body.elections.reduce((s, e) => s + e.electedMinor, 0);
    const id = randomUUID();
    await sqlClient.begin(async (sql) => {
      await sql.unsafe("SELECT set_config('app.tenant_id', $1, true)", [ctx.tenantId]);
      await sql.unsafe(`INSERT INTO employee.benefit_elections (id, tenant_id, plan_id, employee_id, fy, elections, total_elected_minor) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (tenant_id, plan_id, employee_id, fy) DO UPDATE SET elections = EXCLUDED.elections, total_elected_minor = EXCLUDED.total_elected_minor`, [id, ctx.tenantId, body.planId, ctx.actorId, body.fy, JSON.stringify(body.elections), total]);
    });
    return reply.code(201).send({ data: { id, totalElectedMinor: total } });
  });

  app.get("/v1/hrms/benefits/my-elections", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ALL_ROLES);
    const rows = await sqlClient.begin(async (sql) => {
      await sql.unsafe("SELECT set_config('app.tenant_id', $1, true)", [ctx.tenantId]);
      return sql.unsafe(`SELECT be.id, bp.name AS plan_name, be.fy, be.elections, be.total_elected_minor, be.status FROM employee.benefit_elections be JOIN employee.benefit_plans bp ON bp.id = be.plan_id WHERE be.tenant_id = $1 AND be.employee_id = $2 ORDER BY be.fy DESC LIMIT 10`, [ctx.tenantId, ctx.actorId]);
    });
    return reply.send({ data: rows });
  });



  // ── Gap: All Disciplinary Cases (list) ────────────────────────────────────
  // GUC fix: disciplinary.hrms_disciplinary_cases has FORCE ROW LEVEL
  // SECURITY (migration 0034); sqlPool.query() never set app.tenant_id here,
  // so this list silently returned zero rows for every caller regardless of
  // role or data — the same bug class as certifications/staffing-plan/
  // work-summaries above, just on the disciplinary-cases list rather than
  // its mutating routes (those already got ownership checks in PR #1555;
  // this is the read-side GUC gap that PR's own reviewer found and
  // recommended folding into this file-wide fix).
  app.get("/v1/hrms/disciplinary-cases", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, HR_ROLES);
    // GAP-HR-DISCIPLINARY-04 (CAP): the previous hard LIMIT 200 with no
    // cursor/offset made case #201+ permanently unreachable and made every
    // stat card (computed client-side from just these 200 rows) silently
    // understate the true total once a tenant passed 200 cases. limit/offset
    // are bounded and zod-validated; stats below are a separate,
    // unconditional COUNT(*) aggregate over the whole tenant so the cards
    // stay exact regardless of which page is being viewed.
    const { limit, offset } = z.object({
      limit: z.coerce.number().int().min(1).max(200).default(200),
      offset: z.coerce.number().int().min(0).default(0),
    }).parse(req.query);
    const rows = await sqlClient.begin(async (sql) => {
      await sql.unsafe("SELECT set_config('app.tenant_id', $1, true)", [ctx.tenantId]);
      return sql.unsafe(`
        SELECT c.id, c.case_no AS "caseNo", e.full_name AS employee, COALESCE(d.name,'—') AS department,
               c.proceeding_type,
               -- GAP-HR-DISCIPLINARY-01 (PII/DPDP): full allegation text used to be
               -- shipped to every caller of this list; only a short summary crosses
               -- the wire here now, full text stays behind the existing per-case
               -- detail route's own role gate (disciplinary/routes.ts).
               CASE WHEN length(c.allegation) > 80
                 THEN LEFT(c.allegation, 80) || '…'
                 ELSE c.allegation END AS charges_summary,
               c.charge_memo_date AS filed_date,
               COALESCE(c.inquiry_officer_name,'Unassigned') AS inquiry_officer,
               c.status
        FROM disciplinary.hrms_disciplinary_cases c
        JOIN employee.hrms_employees e ON e.id = c.employee_id AND e.tenant_id = $1
        LEFT JOIN employee.hrms_departments d ON d.id = e.department_id AND d.tenant_id = $1
        WHERE c.tenant_id = $1
        -- GAP-HR-DISCIPLINARY-04: order by whichever date actually exists so an
        -- unfiled "opened" case (no charge memo yet) isn't the first thing a
        -- cursor drops once cases run past one page.
        ORDER BY COALESCE(c.charge_memo_date, c.created_at) DESC LIMIT $2 OFFSET $3
      `, [ctx.tenantId, limit, offset]);
    });
    const statsRows = await sqlClient.begin(async (sql) => {
      await sql.unsafe("SELECT set_config('app.tenant_id', $1, true)", [ctx.tenantId]);
      return sql.unsafe(`
        SELECT COUNT(*)::int AS total,
               COUNT(*) FILTER (WHERE proceeding_type = 'major')::int AS major,
               COUNT(*) FILTER (WHERE proceeding_type = 'minor')::int AS minor,
               COUNT(*) FILTER (WHERE status NOT IN ('closed','dropped'))::int AS open
        FROM disciplinary.hrms_disciplinary_cases
        WHERE tenant_id = $1
      `, [ctx.tenantId]);
    });
    // A bare COUNT(*) aggregate with no GROUP BY always returns exactly one
    // row -- this guard is purely to satisfy strict null checks on the
    // driver's generic Row[] return type, not a real "no rows" case.
    const stats = statsRows[0];
    if (!stats) throw new HttpError(500, "INTERNAL", "disciplinary stats aggregate returned no rows");
    // GAP-HR-DISCIPLINARY-01: per-view read audit. Best-effort — a failure to
    // record the audit event must not take down the list read itself. Must
    // go through db.transaction() (not a bare db.insert()) — that's the only
    // thing wrapWithTenantGuc() actually intercepts to inject app.tenant_id;
    // _outbox.messages enforces RLS on this deployment despite the package's
    // own "deliberately no RLS on this table" doc comment, so a bare call
    // fails with "new row violates row-level security policy".
    try {
      await db.transaction(async (tx) => {
        await emitAudit(
          tx, { tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId },
          "hrms.disciplinary.list_viewed", "disciplinary_case_list", ctx.tenantId, { count: rows.length },
        );
      });
    } catch (err) {
      captureError(err, { service: "hrms", event: "audit_emit_failed", action: "hrms.disciplinary.list_viewed" });
    }
    // GAP-HR-DISCIPLINARY-04: hasMore/total/stats let the page render real
    // pagination and exact counts instead of silently truncating at 200.
    return reply.send({
      data: rows,
      total: stats.total,
      hasMore: offset + rows.length < stats.total,
      stats: { major: stats.major, minor: stats.minor, open: stats.open },
    });
  });

  // ── Gap: Certifications ────────────────────────────────────────────────────
  // GUC fix: training.hrms_nominations/hrms_trainings have FORCE ROW LEVEL
  // SECURITY (confirmed in migrations 0026/0034); not in the review's named
  // list of affected tables, but sqlPool.query() never set app.tenant_id
  // here either, so this route silently returned zero rows for every
  // caller too. Not ICC/DPC-related (disciplinary/vigilance is out of
  // scope; this is unrelated training-certificate data) — included.
  app.get("/v1/hrms/certifications", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, READER_ROLES);
    // IDOR fix (CERTIFICATIONS-02): this route had NO employee scoping at
    // all -- any employee/manager got every employee's completed training
    // certifications tenant-wide. This route had no existing scope
    // precedent of its own to preserve (unlike resolveOwnEmployeeIdIfBareEmployee
    // above, which encodes THIS file's separate "manager = privileged"
    // convention for skills/work-summaries) — a fresh check here targets
    // the campaign's stated model: HR unrestricted, manager scoped to self
    // + direct reports, bare employee scoped to self.
    const scope = await resolveCertificationsScope(ctx);
    if (Array.isArray(scope) && scope.length === 0) return reply.send({ data: [] });
    const rows = await sqlClient.begin(async (sql) => {
      await sql.unsafe("SELECT set_config('app.tenant_id', $1, true)", [ctx.tenantId]);
      return sql.unsafe(`
        SELECT n.id, e.full_name AS employee, COALESCE(d.name,'—') AS department,
               t.title AS certification, COALESCE(t.facilitator,'Internal') AS "issuingBody",
               n.training_id AS "trainingId",
               n.completed_date AS "issuedDate",
               -- GAP-HR-CERTIFICATIONS-01: was hard-coded NULL::date/'valid',
               -- so expiry tracking (banner, Expiring Soon/Expired stats, red
               -- cards, sorting) could never fire against live data. Now
               -- computed from the new training.hrms_trainings.validity_months
               -- (migration 0164) when both it and completed_date are known;
               -- otherwise NULL -- genuinely "no expiry tracking configured",
               -- never a fabricated date or a silently-assumed "valid".
               -- Status itself is deliberately NOT computed here: the client
               -- derives it from expiryDate via the single shared
               -- lib/certifications.ts (GAP-HR-CERTIFICATIONS-06) so there is
               -- exactly one status-derivation implementation, not a SQL copy
               -- and a TS copy that can drift apart.
               CASE WHEN t.validity_months IS NOT NULL AND n.completed_date IS NOT NULL
                    THEN (n.completed_date + (t.validity_months || ' months')::interval)::date
                    ELSE NULL END AS "expiryDate"
        FROM training.hrms_nominations n
        JOIN training.hrms_trainings t ON t.id = n.training_id AND t.tenant_id = $1
        JOIN employee.hrms_employees e ON e.id = n.employee_id AND e.tenant_id = $1
        LEFT JOIN employee.hrms_departments d ON d.id = e.department_id AND d.tenant_id = $1
        WHERE n.tenant_id = $1 AND n.status = 'completed' AND n.certificate_ref IS NOT NULL
        ${scope ? "AND n.employee_id = ANY($2::uuid[])" : ""}
        ORDER BY n.completed_date DESC NULLS LAST LIMIT 200
      `, scope ? [ctx.tenantId, scope] : [ctx.tenantId]);
    });
    return reply.send({ data: rows });
  });

  // ── Gap: Grievances (minor disciplinary cases) ─────────────────────────────
  app.get("/v1/hrms/grievances", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, HR_ROLES);
    // Grievance table pending dedicated migration — stub until hrms_grievances is created
    return reply.send({ data: [], meta: { note: "Grievance table pending — coming in next migration" } });
  });

  // ── Gap: Skills (employee competency assessments) ──────────────────────────
  // IDOR fix (audit): org-wide list dump with no employee filter, exposing
  // every employee's competency data to any employee/manager. Self-scoped
  // for non-HR callers (see resolveOwnEmployeeIdIfNonHr above).
  app.get("/v1/hrms/skills", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, READER_ROLES);
    const scopeId = await resolveOwnEmployeeIdIfNonHr(ctx, req);
    if (scopeId === null) return reply.send({ data: [], meta: { total: 0, hasMore: false } });
    // GAP-HR-SKILLS-06: the old hard LIMIT 500 with no offset/total silently
    // truncated with no way for the client to know or page further.
    const q = z.object({
      limit: z.coerce.number().int().min(1).max(500).default(500),
      offset: z.coerce.number().int().min(0).default(0),
    }).parse(req.query);
    const scopeParams = scopeId !== undefined ? [ctx.tenantId, scopeId] : [ctx.tenantId];
    const { rows, total } = await sqlClient.begin(async (sql) => {
      await sql.unsafe("SELECT set_config('app.tenant_id', $1, true)", [ctx.tenantId]);
      const countRows = await sql.unsafe(
        `SELECT COUNT(*)::int AS count FROM employee.skill_assessments sa
         WHERE sa.tenant_id = $1 ${scopeId !== undefined ? "AND sa.employee_id = $2" : ""}`,
        scopeParams,
      );
      const dataRows = await sql.unsafe(`
        SELECT sa.id, e.full_name AS employee, COALESCE(d.name,'—') AS department,
               c.name AS skill, c.category, sa.assessed_level AS proficiency,
               COALESCE(ae.full_name,'—') AS "assessedBy", sa.assessed_at AS "lastAssessed"
        FROM employee.skill_assessments sa
        JOIN employee.competencies c ON c.id = sa.competency_id AND c.tenant_id = $1
        JOIN employee.hrms_employees e ON e.id = sa.employee_id AND e.tenant_id = $1
        LEFT JOIN employee.hrms_departments d ON d.id = e.department_id AND d.tenant_id = $1
        LEFT JOIN employee.hrms_employees ae ON ae.id = sa.assessed_by AND ae.tenant_id = $1
        WHERE sa.tenant_id = $1 ${scopeId !== undefined ? "AND sa.employee_id = $2" : ""}
        ORDER BY sa.assessed_at DESC
        LIMIT ${scopeId !== undefined ? "$3" : "$2"} OFFSET ${scopeId !== undefined ? "$4" : "$3"}
      `, [...scopeParams, q.limit, q.offset]);
      return { rows: dataRows, total: Number(countRows[0]?.count ?? 0) };
    });
    return reply.send({ data: rows, meta: { total, hasMore: q.offset + rows.length < total } });
  });

  // ── Gap: Staffing Plan (manpower vacancy analysis) ─────────────────────────
  app.get("/v1/hrms/staffing-plan", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, HR_ROLES);
    // GAP-HR-STAFFING-PLAN-04: this query previously had no year filter at
    // all (ORDER BY plan_year DESC only, no WHERE on it, and plan_year was
    // not even in the SELECT list), so the page's stats silently summed
    // every plan_year (and status) together -- a real correctness bug for
    // vacancy/hiring decisions. `?year=` scopes to one plan_year;
    // omitted/invalid falls back to the most recent plan_year this tenant
    // has any plan for.
    const q = z.object({
      year: z.coerce.number().int().min(2000).max(2100).optional(),
    }).parse(req.query);
    // manpower.current_tenant_id() requires app.tenant_id; use a transaction with SET LOCAL.
    // NOTE: `SET LOCAL x = $1` is not valid Postgres syntax — SET does not accept a bind
    // parameter (always failed with "syntax error at or near \"$1\"", a 500 on every call).
    // set_config() is a regular function call and DOES accept one; the same
    // technique wrapWithTenantGuc() (packages/db/src/wrap-tenant-db.ts)
    // already uses to inject the GUC into a Drizzle transaction.
    const { rows, years, resolvedYear } = await sqlClient.begin(async (sql) => {
      await sql.unsafe("SELECT set_config('app.tenant_id', $1, true)", [ctx.tenantId]);
      const yearRows = await sql.unsafe(
        `SELECT DISTINCT plan_year AS "planYear" FROM manpower.plans WHERE tenant_id = $1 ORDER BY "planYear" DESC`,
        [ctx.tenantId],
      );
      const planYears = yearRows.map((r) => Number(r.planYear));
      const targetYear = q.year ?? planYears[0] ?? new Date().getFullYear();
      // GAP-HR-STAFFING-PLAN-03: `department` is now `d.name` alone
      // (nullable) rather than the old COALESCE(d.name, p.cadre) -- that
      // COALESCE meant `cadre` was effectively swallowed into `department`
      // whenever a department link existed, even though `cadre` is also
      // selected as its own column. Returning the two independently lets
      // the web layer combine or split them instead of guessing.
      // GAP-HR-STAFFING-PLAN-02: `lastReview` was p.updated_at -- a plain
      // row-touch timestamp, not an actual review date (no dedicated
      // review-date column exists). manpower.plans IS a maker-checker
      // workflow table (submitted_at/approved_at alongside updated_at --
      // see manpower-planning/schema.ts), so this reframes "last review" as
      // whichever workflow milestone most recently touched the row
      // (approved > submitted > updated) rather than renaming the field to
      // a plain "last updated" -- a draft never submitted still only has
      // updated_at, which remains a reasonable fallback for that case.
      // GAP-HR-STAFFING-PLAN-01: explicit ::float8 cast so postgres-js
      // returns a real JS number over the wire instead of a numeric-as-
      // string (the web side's mapRows also defensively coerces).
      const dataRows = await sql.unsafe(`
        SELECT p.id, d.name AS department, p.cadre, p.plan_year AS "planYear",
               p.sanctioned_strength AS "sanctionedPosts", p.filled_strength AS filled,
               GREATEST(p.sanctioned_strength - p.filled_strength, 0) AS vacant,
               CASE WHEN p.sanctioned_strength > 0
                 THEN ROUND((p.filled_strength::numeric / p.sanctioned_strength) * 100, 1)::float8
                 ELSE 0::float8 END AS "fillPercentage",
               COALESCE(p.approved_at, p.submitted_at, p.updated_at) AS "lastReview", p.status
        FROM manpower.plans p
        LEFT JOIN employee.hrms_departments d ON d.id = p.unit_id AND d.tenant_id = $1
        WHERE p.tenant_id = $1 AND p.plan_year = $2
        ORDER BY "fillPercentage" ASC LIMIT 200
      `, [ctx.tenantId, targetYear]);
      return { rows: dataRows, years: planYears, resolvedYear: targetYear };
    });
    return reply.send({ data: rows, meta: { planYear: resolvedYear, availableYears: years } });
  });

  // ── Gap: Vigilance (major disciplinary cases) ──────────────────────────────
  // GUC fix: same as disciplinary-cases above — this list queries the same
  // FORCE-RLS table (filtered to proceeding_type='major') and had the same
  // missing app.tenant_id gap, silently returning zero rows for every caller.
  app.get("/v1/hrms/vigilance", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, HR_ROLES);
    // GAP-HR-VIGILANCE-01 (PII/DPDP decision packet, interim containment):
    // a case that ended 'dropped' (exonerated/discontinued) is hidden from
    // this list by default — not deleted or redacted at the DB layer, just
    // excluded from THIS response — so it stops surfacing indefinitely to
    // every hr_officer. A caller who genuinely needs it (e.g. re-opening,
    // audit review) can still retrieve it with includeDropped=true; this is
    // a stopgap ahead of a real retention/purge rule, which needs separate
    // legal sign-off (see decision packet).
    // GAP-HR-VIGILANCE-04 (CAP): same unpaginated LIMIT 200 bug as the
    // disciplinary list above — limit/offset are bounded and zod-validated.
    const { includeDropped, limit, offset } = z.object({
      includeDropped: z.enum(["true", "false"]).optional().transform((v) => v === "true"),
      limit: z.coerce.number().int().min(1).max(200).default(200),
      offset: z.coerce.number().int().min(0).default(0),
    }).parse(req.query);
    const rows = await sqlClient.begin(async (sql) => {
      await sql.unsafe("SELECT set_config('app.tenant_id', $1, true)", [ctx.tenantId]);
      return sql.unsafe(`
        SELECT c.id, c.case_no AS "caseNo", e.full_name AS employee, COALESCE(d.name,'—') AS department,
               -- GAP-HR-VIGILANCE-01 (PII/DPDP): same list-view truncation as
               -- GAP-HR-DISCIPLINARY-01 — full text stays on the detail route.
               CASE WHEN length(c.allegation) > 80
                 THEN LEFT(c.allegation, 80) || '…'
                 ELSE c.allegation END AS charges_summary,
               c.charge_memo_date AS "filedDate",
               COALESCE(c.inquiry_officer_name,'Not Appointed') AS "inquiryOfficer",
               -- GAP-HR-VIGILANCE-03: "nextHearing" is a misleading name for a
               -- one-time appointment date, not a recurring hearing schedule.
               -- Aliased under both names for one release so existing callers
               -- of the old key keep working while new ones can move to the
               -- honestly-named one.
               c.inquiry_appointed_date AS "nextHearing",
               c.inquiry_appointed_date AS "inquiryAppointedDate", c.status
        FROM disciplinary.hrms_disciplinary_cases c
        JOIN employee.hrms_employees e ON e.id = c.employee_id AND e.tenant_id = $1
        LEFT JOIN employee.hrms_departments d ON d.id = e.department_id AND d.tenant_id = $1
        WHERE c.tenant_id = $1 AND c.proceeding_type = 'major'
          ${includeDropped ? "" : "AND c.status <> 'dropped'"}
        ORDER BY COALESCE(c.charge_memo_date, c.created_at) DESC LIMIT $2 OFFSET $3
      `, [ctx.tenantId, limit, offset]);
    });
    // GAP-HR-VIGILANCE-02/04: stat-card buckets computed server-side, over
    // the whole tenant's major cases -- not just the current page's rows, so
    // they stay exact once results are paginated. Groups come from
    // VIGILANCE_STATUS_GROUPS (mutually exclusive, exhaustive over all 10
    // CaseStatus values); "dropped" always counts toward total here (a plain
    // number, not a row of PII) even when includeDropped=false hides the
    // underlying rows from the list above. The IN lists interpolate only
    // those compile-time constants -- no request input reaches this SQL.
    const inList = (statuses: readonly string[]) => statuses.map((st) => `'${st}'`).join(",");
    const G = VIGILANCE_STATUS_GROUPS;
    const vigilanceStatsRows = await sqlClient.begin(async (sql) => {
      await sql.unsafe("SELECT set_config('app.tenant_id', $1, true)", [ctx.tenantId]);
      return sql.unsafe(`
        SELECT COUNT(*)::int AS total,
               COUNT(*) FILTER (WHERE status IN (${inList(G.chargeMemoStage)}))::int AS charge_memo_stage,
               COUNT(*) FILTER (WHERE status IN (${inList(G.underInquiry)}))::int AS under_inquiry,
               COUNT(*) FILTER (WHERE status IN (${inList(G.penaltyAndAppeal)}))::int AS penalty_and_appeal,
               COUNT(*) FILTER (WHERE status IN (${inList(G.closed)}))::int AS closed,
               COUNT(*) FILTER (WHERE status IN (${inList(G.dropped)}))::int AS dropped_count
        FROM disciplinary.hrms_disciplinary_cases
        WHERE tenant_id = $1 AND proceeding_type = 'major'
      `, [ctx.tenantId]);
    });
    // A bare COUNT(*) aggregate with no GROUP BY always returns exactly one
    // row -- this guard is purely to satisfy strict null checks on the
    // driver's generic Row[] return type, not a real "no rows" case.
    const stats = vigilanceStatsRows[0];
    if (!stats) throw new HttpError(500, "INTERNAL", "vigilance stats aggregate returned no rows");
    const visibleTotal = includeDropped ? stats.total : stats.total - stats.dropped_count;
    // GAP-HR-VIGILANCE-01: per-view read audit, same best-effort shape (and
    // same db.transaction() requirement — see the disciplinary list above)
    // as the disciplinary list.
    try {
      await db.transaction(async (tx) => {
        await emitAudit(
          tx, { tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId },
          "hrms.vigilance.list_viewed", "vigilance_case_list", ctx.tenantId, { count: rows.length, includeDropped },
        );
      });
    } catch (err) {
      captureError(err, { service: "hrms", event: "audit_emit_failed", action: "hrms.vigilance.list_viewed" });
    }
    return reply.send({
      data: rows,
      total: visibleTotal,
      hasMore: offset + rows.length < visibleTotal,
      stats: {
        chargeMemoStage: stats.charge_memo_stage,
        underInquiry: stats.under_inquiry,
        penaltyAndAppeal: stats.penalty_and_appeal,
        closed: stats.closed,
        dropped: stats.dropped_count,
        total: stats.total,
      },
    });
  });

  // ── Gap: Work Summaries (derived from appraisals) ─────────────────────────
  // IDOR fix (audit): org-wide list dump with no employee filter, exposing
  // every employee's appraisal-derived data to any employee/manager.
  // Self-scoped for non-HR callers (see resolveOwnEmployeeIdIfNonHr above).
  app.get("/v1/hrms/work-summaries", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, READER_ROLES);
    const scopeId = await resolveOwnEmployeeIdIfNonHr(ctx, req);
    if (scopeId === null) return reply.send({ data: [], total: 0, offset: 0 });
    const q = z.object({ offset: z.coerce.number().int().min(0).default(0) }).parse(req.query ?? {});
    const PAGE_SIZE = 500;
    // GUC fix: appraisal.hrms_appraisals has FORCE ROW LEVEL SECURITY;
    // sqlPool.query() never set app.tenant_id, so work-summaries silently
    // returned zero rows for every caller (HR included) regardless of the
    // employee-scoping above.
    const { rows, total } = await sqlClient.begin(async (sql) => {
      await sql.unsafe("SELECT set_config('app.tenant_id', $1, true)", [ctx.tenantId]);
      const whereClause = scopeId !== undefined ? "AND a.employee_id = $2" : "";
      const countParams = scopeId !== undefined ? [ctx.tenantId, scopeId] : [ctx.tenantId];
      const countRows = await sql.unsafe(`
        SELECT COUNT(*)::int AS total
        FROM appraisal.hrms_appraisals a
        WHERE a.tenant_id = $1 ${whereClause}
      `, countParams);
      const total = Number(countRows[0]?.total ?? 0);

      // GAP-HR-WORK-SUMMARY-01/02: this used to invent "tasks" data
      // (COALESCE(...overall_grade...) AS tasksCompleted + a literal
      // `10 AS totalTasks` + a literal `'annual' AS periodType) with no
      // underlying task data anywhere in this source, and masked a genuinely
      // NULL rating as 0 (COALESCE(a.rating,0)) so an unrated appraisal
      // looked like a real "0.0 / 5" score. Now selects the real
      // overall_grade/rating columns un-coalesced (frontend renders null as
      // "—") and drops the fabricated tasks/periodType fields entirely
      // rather than inventing a replacement source for them. Also now
      // selects e.id AS employeeId (GAP-HR-WORK-SUMMARY-06 — the frontend
      // used to count distinct employees by *display name*, silently
      // merging same-named people) and supports offset-based pagination
      // (GAP-HR-WORK-SUMMARY-05 — LIMIT 500 previously truncated silently
      // with no total count and no way to see the rest).
      const dataParams = scopeId !== undefined
        ? [ctx.tenantId, scopeId, PAGE_SIZE, q.offset]
        : [ctx.tenantId, PAGE_SIZE, q.offset];
      const limitIdx = scopeId !== undefined ? 3 : 2;
      const offsetIdx = scopeId !== undefined ? 4 : 3;
      const rows = await sql.unsafe(`
        SELECT a.id, e.full_name AS employee, e.id AS "employeeId", COALESCE(d.name,'—') AS department,
               a.appraisal_period AS period,
               a.overall_grade AS "overallGrade",
               a.rating AS rating, a.status
        FROM appraisal.hrms_appraisals a
        JOIN employee.hrms_employees e ON e.id = a.employee_id AND e.tenant_id = $1
        LEFT JOIN employee.hrms_departments d ON d.id = e.department_id AND d.tenant_id = $1
        WHERE a.tenant_id = $1 ${whereClause}
        ORDER BY a.appraisal_period DESC, e.full_name LIMIT $${limitIdx} OFFSET $${offsetIdx}
      `, dataParams);
      return { rows, total };
    });
    return reply.send({ data: rows, total, offset: q.offset });
  });

  // Error handler
  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) { return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false, fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })) }); }
    if (err instanceof HttpError) { return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false }); }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
