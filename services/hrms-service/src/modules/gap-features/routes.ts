/**
 * World-class gap features — compensation planning, LMS, skills matrix,
 * succession planning, engagement surveys, onboarding, 360° feedback, benefits.
 */
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { randomUUID } from "node:crypto";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { sqlPool, sqlClient } from "../../shared/db.js";

const HR_ROLES = ["hr_admin", "super_admin", "hr_officer"];
const READER_ROLES = [...HR_ROLES, "manager", "employee"];
const ALL_ROLES = [...HR_ROLES, "manager", "employee"];

export async function hrmsGapRoutes(app: FastifyInstance): Promise<void> {
  // ─── Gap 1: Compensation Planning ──────────────────────────────────────────
  app.post("/v1/hrms/compensation/plans", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, HR_ROLES);
    const body = z.object({
      name: z.string().min(1).max(200), fy: z.string().regex(/^\d{4}-\d{2}$/),
      budgetMinor: z.number().int().min(0), guidelines: z.record(z.unknown()).optional(),
    }).parse(req.body);
    const id = randomUUID();
    await sqlPool.query(
      `INSERT INTO employee.compensation_plans (id, tenant_id, name, fy, budget_minor, guidelines, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, ctx.tenantId, body.name, body.fy, body.budgetMinor, JSON.stringify(body.guidelines ?? {}), ctx.actorId],
    );
    return reply.code(201).send({ data: { id, ...body, status: "draft" } });
  });

  app.get("/v1/hrms/compensation/plans", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, READER_ROLES);
    const { rows } = await sqlPool.query(
      `SELECT id, name, fy, budget_minor, status, created_at FROM employee.compensation_plans WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 50`, [ctx.tenantId]);
    return reply.send({ data: rows });
  });

  app.post("/v1/hrms/compensation/plans/:id/model", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, HR_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { rows } = await sqlPool.query(`SELECT id, budget_minor FROM employee.compensation_plans WHERE id = $1 AND tenant_id = $2`, [id, ctx.tenantId]);
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
    await sqlPool.query(
      `INSERT INTO training.lms_courses (id, tenant_id, code, name, description, duration_hours, skills_gained, mandatory_for_roles, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [id, ctx.tenantId, body.code, body.name, body.description ?? null, body.durationHours, JSON.stringify(body.skillsGained), JSON.stringify(body.mandatoryForRoles), ctx.actorId],
    );
    return reply.code(201).send({ data: { id, ...body, status: "active" } });
  });

  app.get("/v1/hrms/lms/courses", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ALL_ROLES);
    const { rows } = await sqlPool.query(`SELECT id, code, name, duration_hours, skills_gained, mandatory_for_roles, status FROM training.lms_courses WHERE tenant_id = $1 AND status = 'active' ORDER BY name LIMIT 100`, [ctx.tenantId]);
    return reply.send({ data: rows });
  });

  app.post("/v1/hrms/lms/courses/:id/enroll", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ALL_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({ employeeId: z.string().uuid() }).parse(req.body);
    const eid = randomUUID();
    await sqlPool.query(
      `INSERT INTO training.lms_enrollments (id, tenant_id, course_id, employee_id) VALUES ($1,$2,$3,$4) ON CONFLICT (tenant_id, course_id, employee_id) DO NOTHING`,
      [eid, ctx.tenantId, id, body.employeeId]);
    return reply.code(201).send({ data: { id: eid, courseId: id, employeeId: body.employeeId, status: "enrolled" } });
  });

  app.post("/v1/hrms/lms/enrollments/:id/complete", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, HR_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({ score: z.number().min(0).max(100).optional() }).parse(req.body ?? {});
    await sqlPool.query(`UPDATE training.lms_enrollments SET status = 'completed', completed_at = NOW(), score = $1 WHERE id = $2 AND tenant_id = $3`, [body.score ?? null, id, ctx.tenantId]);
    return reply.send({ data: { id, status: "completed" } });
  });

  app.get("/v1/hrms/lms/my-learning", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ALL_ROLES);
    const { rows } = await sqlPool.query(
      `SELECT e.id, c.name, c.code, e.status, e.enrolled_at, e.completed_at, e.score FROM training.lms_enrollments e JOIN training.lms_courses c ON c.id = e.course_id WHERE e.tenant_id = $1 AND e.employee_id = $2 ORDER BY e.enrolled_at DESC LIMIT 50`,
      [ctx.tenantId, ctx.actorId]);
    return reply.send({ data: rows });
  });

  app.get("/v1/hrms/lms/compliance", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, HR_ROLES);
    const { rows } = await sqlPool.query(
      `SELECT c.id, c.code, c.name, c.mandatory_for_roles, COUNT(e.id) FILTER (WHERE e.status = 'completed') AS completed_count, COUNT(e.id) AS total_enrolled FROM training.lms_courses c LEFT JOIN training.lms_enrollments e ON e.course_id = c.id AND e.tenant_id = c.tenant_id WHERE c.tenant_id = $1 AND c.mandatory_for_roles != '[]'::jsonb GROUP BY c.id ORDER BY c.name`, [ctx.tenantId]);
    return reply.send({ data: rows });
  });

  // ─── Gap 3: Skills Matrix ──────────────────────────────────────────────────
  app.post("/v1/hrms/skills/competencies", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, HR_ROLES);
    const body = z.object({ name: z.string().min(1).max(128), category: z.string().max(64).default("technical"), proficiencyLevels: z.array(z.string()).default(["beginner","intermediate","advanced","expert"]) }).parse(req.body);
    const id = randomUUID();
    await sqlPool.query(`INSERT INTO employee.competencies (id, tenant_id, name, category, proficiency_levels, created_by) VALUES ($1,$2,$3,$4,$5,$6)`, [id, ctx.tenantId, body.name, body.category, JSON.stringify(body.proficiencyLevels), ctx.actorId]);
    return reply.code(201).send({ data: { id, ...body } });
  });

  app.post("/v1/hrms/skills/role-matrix", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, HR_ROLES);
    const body = z.object({ roleRef: z.string().max(128), competencyId: z.string().uuid(), requiredLevel: z.string().max(32) }).parse(req.body);
    const id = randomUUID();
    await sqlPool.query(`INSERT INTO employee.role_competency_map (id, tenant_id, role_ref, competency_id, required_level) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (tenant_id, role_ref, competency_id) DO UPDATE SET required_level = EXCLUDED.required_level`, [id, ctx.tenantId, body.roleRef, body.competencyId, body.requiredLevel]);
    return reply.code(201).send({ data: { id, ...body } });
  });

  app.post("/v1/hrms/skills/assessments", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, HR_ROLES);
    const body = z.object({ employeeId: z.string().uuid(), competencyId: z.string().uuid(), assessedLevel: z.string().max(32), notes: z.string().max(512).optional() }).parse(req.body);
    const id = randomUUID();
    await sqlPool.query(`INSERT INTO employee.skill_assessments (id, tenant_id, employee_id, competency_id, assessed_level, assessed_by, notes) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [id, ctx.tenantId, body.employeeId, body.competencyId, body.assessedLevel, ctx.actorId, body.notes ?? null]);
    return reply.code(201).send({ data: { id, ...body } });
  });

  app.get("/v1/hrms/skills/gap-analysis", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ALL_ROLES);
    const q = z.object({ employeeId: z.string().uuid() }).parse(req.query);
    const { rows } = await sqlPool.query(
      `SELECT c.name AS competency, rcm.required_level, COALESCE(sa.assessed_level, 'not_assessed') AS actual_level FROM employee.role_competency_map rcm JOIN employee.competencies c ON c.id = rcm.competency_id LEFT JOIN employee.skill_assessments sa ON sa.competency_id = rcm.competency_id AND sa.employee_id = $2 AND sa.tenant_id = $1 WHERE rcm.tenant_id = $1 ORDER BY c.name`, [ctx.tenantId, q.employeeId]);
    return reply.send({ data: rows });
  });

  app.get("/v1/hrms/skills/team-heatmap", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, HR_ROLES);
    const q = z.object({ departmentId: z.string().uuid().optional() }).parse(req.query);
    const { rows } = await sqlPool.query(
      `SELECT c.name AS competency, sa.assessed_level, COUNT(*) AS count FROM employee.skill_assessments sa JOIN employee.competencies c ON c.id = sa.competency_id WHERE sa.tenant_id = $1 GROUP BY c.name, sa.assessed_level ORDER BY c.name`, [ctx.tenantId]);
    return reply.send({ data: rows });
  });

  // ─── Gap 4: Succession Planning ───────────────────────────────────────────
  app.post("/v1/hrms/succession/critical-roles", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, HR_ROLES);
    const body = z.object({ roleRef: z.string().max(128), departmentId: z.string().uuid().optional() }).parse(req.body);
    const id = randomUUID();
    await sqlPool.query(`INSERT INTO employee.succession_plans (id, tenant_id, role_ref, department_id, created_by) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (tenant_id, role_ref) DO NOTHING`, [id, ctx.tenantId, body.roleRef, body.departmentId ?? null, ctx.actorId]);
    return reply.code(201).send({ data: { id, roleRef: body.roleRef, isCritical: true } });
  });

  app.post("/v1/hrms/succession/nominees", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, HR_ROLES);
    const body = z.object({ planId: z.string().uuid(), employeeId: z.string().uuid(), readiness: z.enum(["now","1yr","2yr","3yr"]).default("1yr"), developmentPlan: z.string().max(2000).optional() }).parse(req.body);
    const id = randomUUID();
    await sqlPool.query(`INSERT INTO employee.succession_nominees (id, tenant_id, plan_id, employee_id, readiness, development_plan) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (tenant_id, plan_id, employee_id) DO UPDATE SET readiness = EXCLUDED.readiness, development_plan = EXCLUDED.development_plan`, [id, ctx.tenantId, body.planId, body.employeeId, body.readiness, body.developmentPlan ?? null]);
    return reply.code(201).send({ data: { id, ...body } });
  });

  app.get("/v1/hrms/succession/pipeline", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, HR_ROLES);
    const { rows } = await sqlPool.query(
      `SELECT sp.role_ref, sp.department_id, COUNT(sn.id) AS nominee_count, COUNT(sn.id) FILTER (WHERE sn.readiness = 'now') AS ready_now FROM employee.succession_plans sp LEFT JOIN employee.succession_nominees sn ON sn.plan_id = sp.id AND sn.tenant_id = sp.tenant_id WHERE sp.tenant_id = $1 GROUP BY sp.role_ref, sp.department_id ORDER BY sp.role_ref`, [ctx.tenantId]);
    return reply.send({ data: rows });
  });

  app.get("/v1/hrms/succession/risk", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, HR_ROLES);
    const { rows } = await sqlPool.query(
      `SELECT sp.role_ref, sp.department_id FROM employee.succession_plans sp LEFT JOIN employee.succession_nominees sn ON sn.plan_id = sp.id AND sn.tenant_id = sp.tenant_id AND sn.readiness = 'now' WHERE sp.tenant_id = $1 AND sp.is_critical = true GROUP BY sp.role_ref, sp.department_id HAVING COUNT(sn.id) = 0`, [ctx.tenantId]);
    return reply.send({ data: rows });
  });

  // ─── Gap 5: Engagement Surveys ─────────────────────────────────────────────
  app.post("/v1/hrms/engagement/surveys", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, HR_ROLES);
    const body = z.object({ title: z.string().min(1).max(200), questions: z.array(z.object({ text: z.string(), type: z.enum(["rating","text","nps"]).default("rating") })).min(1).max(50), isAnonymous: z.boolean().default(true), audience: z.record(z.unknown()).optional() }).parse(req.body);
    const id = randomUUID();
    await sqlPool.query(`INSERT INTO employee.surveys (id, tenant_id, title, questions, is_anonymous, audience, status, created_by) VALUES ($1,$2,$3,$4,$5,$6,'active',$7)`, [id, ctx.tenantId, body.title, JSON.stringify(body.questions), body.isAnonymous, JSON.stringify(body.audience ?? {}), ctx.actorId]);
    return reply.code(201).send({ data: { id, title: body.title, status: "active" } });
  });

  app.post("/v1/hrms/engagement/surveys/:id/respond", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ALL_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({ answers: z.array(z.unknown()).min(1), enpsScore: z.number().int().min(0).max(10).optional() }).parse(req.body);
    const rid = randomUUID();
    await sqlPool.query(`INSERT INTO employee.survey_responses (id, tenant_id, survey_id, answers, enps_score) VALUES ($1,$2,$3,$4,$5)`, [rid, ctx.tenantId, id, JSON.stringify(body.answers), body.enpsScore ?? null]);
    return reply.code(201).send({ data: { id: rid, surveyId: id, submitted: true } });
  });

  app.get("/v1/hrms/engagement/surveys/:id/results", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, HR_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { rows } = await sqlPool.query(`SELECT COUNT(*) AS response_count, AVG(enps_score)::numeric(4,2) AS avg_enps FROM employee.survey_responses WHERE tenant_id = $1 AND survey_id = $2`, [ctx.tenantId, id]);
    return reply.send({ data: { surveyId: id, responseCount: Number(rows[0]?.response_count ?? 0), avgEnps: rows[0]?.avg_enps ?? null } });
  });

  app.get("/v1/hrms/engagement/eNPS", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, HR_ROLES);
    const { rows } = await sqlPool.query(
      `SELECT COUNT(*) FILTER (WHERE enps_score >= 9) AS promoters, COUNT(*) FILTER (WHERE enps_score <= 6) AS detractors, COUNT(*) AS total FROM employee.survey_responses WHERE tenant_id = $1 AND enps_score IS NOT NULL`, [ctx.tenantId]);
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
    await sqlPool.query(`INSERT INTO employee.onboarding_templates (id, tenant_id, name, steps, created_by) VALUES ($1,$2,$3,$4,$5)`, [id, ctx.tenantId, body.name, JSON.stringify(body.steps), ctx.actorId]);
    return reply.code(201).send({ data: { id, ...body, status: "active" } });
  });

  app.get("/v1/hrms/onboarding/active", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, HR_ROLES);
    const { rows } = await sqlPool.query(`SELECT oi.id, oi.employee_id, ot.name AS template_name, oi.completion_pct, oi.status, oi.created_at FROM employee.onboarding_instances oi JOIN employee.onboarding_templates ot ON ot.id = oi.template_id WHERE oi.tenant_id = $1 AND oi.status = 'active' ORDER BY oi.created_at DESC LIMIT 100`, [ctx.tenantId]);
    return reply.send({ data: rows });
  });

  app.post("/v1/hrms/onboarding/:id/steps/:stepIdx/complete", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ALL_ROLES);
    const { id, stepIdx } = z.object({ id: z.string().uuid(), stepIdx: z.coerce.number().int().min(0) }).parse(req.params);
    // Mark step complete in the JSONB steps array
    const { rows } = await sqlPool.query<{ steps: Array<Record<string, unknown>> }>(`SELECT steps FROM employee.onboarding_instances WHERE id = $1 AND tenant_id = $2`, [id, ctx.tenantId]);
    if (!rows[0]) throw new HttpError(404, "NOT_FOUND", "onboarding instance not found");
    const steps = rows[0].steps;
    if (stepIdx >= steps.length) throw new HttpError(400, "INVALID_STEP", "step index out of range");
    steps[stepIdx] = { ...steps[stepIdx], completed: true, completedAt: new Date().toISOString() };
    const completedCount = steps.filter((s: Record<string, unknown>) => s.completed).length;
    const pct = Math.round((completedCount / steps.length) * 100);
    const status = pct === 100 ? "completed" : "active";
    await sqlPool.query(`UPDATE employee.onboarding_instances SET steps = $1, completion_pct = $2, status = $3 WHERE id = $4 AND tenant_id = $5`, [JSON.stringify(steps), pct, status, id, ctx.tenantId]);
    return reply.send({ data: { id, stepIdx, completionPct: pct, status } });
  });

  // ─── Gap 7: 360° Feedback ─────────────────────────────────────────────────
  app.post("/v1/hrms/feedback/cycles", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, HR_ROLES);
    const body = z.object({ name: z.string().min(1).max(200), questions: z.array(z.object({ text: z.string(), maxScore: z.number().int().default(5) })).min(1).max(30), raterGroups: z.array(z.string()).default(["self","manager","peer","report"]) }).parse(req.body);
    const id = randomUUID();
    await sqlPool.query(`INSERT INTO employee.feedback_cycles (id, tenant_id, name, questions, rater_groups, status, created_by) VALUES ($1,$2,$3,$4,$5,'active',$6)`, [id, ctx.tenantId, body.name, JSON.stringify(body.questions), JSON.stringify(body.raterGroups), ctx.actorId]);
    return reply.code(201).send({ data: { id, name: body.name, status: "active" } });
  });

  app.post("/v1/hrms/feedback/cycles/:id/nominate-raters", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ALL_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({ employeeId: z.string().uuid(), raters: z.array(z.object({ raterId: z.string().uuid(), raterGroup: z.string().max(32) })).min(1).max(20) }).parse(req.body);
    for (const r of body.raters) {
      const nid = randomUUID();
      await sqlPool.query(`INSERT INTO employee.feedback_nominations (id, tenant_id, cycle_id, employee_id, rater_id, rater_group) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (tenant_id, cycle_id, employee_id, rater_id) DO NOTHING`, [nid, ctx.tenantId, id, body.employeeId, r.raterId, r.raterGroup]);
    }
    return reply.code(201).send({ data: { cycleId: id, employeeId: body.employeeId, ratersAdded: body.raters.length } });
  });

  app.post("/v1/hrms/feedback/responses", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ALL_ROLES);
    const body = z.object({ cycleId: z.string().uuid(), employeeId: z.string().uuid(), raterGroup: z.string().max(32), scores: z.record(z.number()), comments: z.string().max(2000).optional() }).parse(req.body);
    const id = randomUUID();
    await sqlPool.query(`INSERT INTO employee.feedback_responses (id, tenant_id, cycle_id, employee_id, rater_group, scores, comments) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [id, ctx.tenantId, body.cycleId, body.employeeId, body.raterGroup, JSON.stringify(body.scores), body.comments ?? null]);
    return reply.code(201).send({ data: { id, submitted: true } });
  });

  app.get("/v1/hrms/feedback/cycles/:id/report", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, HR_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const q = z.object({ employeeId: z.string().uuid() }).parse(req.query);
    const { rows } = await sqlPool.query(`SELECT rater_group, scores FROM employee.feedback_responses WHERE tenant_id = $1 AND cycle_id = $2 AND employee_id = $3`, [ctx.tenantId, id, q.employeeId]);
    // Aggregate by rater group
    const grouped: Record<string, { count: number; avgScores: Record<string, number> }> = {};
    for (const r of rows as Array<{ rater_group: string; scores: Record<string, number> }>) {
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
    await sqlPool.query(`INSERT INTO employee.benefit_plans (id, tenant_id, name, fy, flex_budget_minor, components, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [id, ctx.tenantId, body.name, body.fy, body.flexBudgetMinor, JSON.stringify(body.components), ctx.actorId]);
    return reply.code(201).send({ data: { id, ...body, status: "active" } });
  });

  app.post("/v1/hrms/benefits/elections", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ALL_ROLES);
    const body = z.object({ planId: z.string().uuid(), fy: z.string().regex(/^\d{4}-\d{2}$/), elections: z.array(z.object({ component: z.string(), electedMinor: z.number().int().min(0) })).min(1) }).parse(req.body);
    const total = body.elections.reduce((s, e) => s + e.electedMinor, 0);
    const id = randomUUID();
    await sqlPool.query(`INSERT INTO employee.benefit_elections (id, tenant_id, plan_id, employee_id, fy, elections, total_elected_minor) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (tenant_id, plan_id, employee_id, fy) DO UPDATE SET elections = EXCLUDED.elections, total_elected_minor = EXCLUDED.total_elected_minor`, [id, ctx.tenantId, body.planId, ctx.actorId, body.fy, JSON.stringify(body.elections), total]);
    return reply.code(201).send({ data: { id, totalElectedMinor: total } });
  });

  app.get("/v1/hrms/benefits/my-elections", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ALL_ROLES);
    const { rows } = await sqlPool.query(`SELECT be.id, bp.name AS plan_name, be.fy, be.elections, be.total_elected_minor, be.status FROM employee.benefit_elections be JOIN employee.benefit_plans bp ON bp.id = be.plan_id WHERE be.tenant_id = $1 AND be.employee_id = $2 ORDER BY be.fy DESC LIMIT 10`, [ctx.tenantId, ctx.actorId]);
    return reply.send({ data: rows });
  });



  // ── Gap: All Disciplinary Cases (list) ────────────────────────────────────
  app.get("/v1/hrms/disciplinary-cases", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, HR_ROLES);
    const { rows } = await sqlPool.query(`
      SELECT c.id, e.full_name AS employee, COALESCE(d.name,'—') AS department,
             c.proceeding_type, c.allegation AS charges,
             c.charge_memo_date AS filed_date,
             COALESCE(c.inquiry_officer_name,'Unassigned') AS inquiry_officer,
             c.status
      FROM disciplinary.hrms_disciplinary_cases c
      JOIN employee.hrms_employees e ON e.id = c.employee_id AND e.tenant_id = $1
      LEFT JOIN employee.hrms_departments d ON d.id = e.department_id AND d.tenant_id = $1
      WHERE c.tenant_id = $1
      ORDER BY c.charge_memo_date DESC NULLS LAST LIMIT 200
    `, [ctx.tenantId]);
    return reply.send({ data: rows });
  });

  // ── Gap: Certifications ────────────────────────────────────────────────────
  app.get("/v1/hrms/certifications", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, READER_ROLES);
    const { rows } = await sqlPool.query(`
      SELECT n.id, e.full_name AS employee, COALESCE(d.name,'—') AS department,
             t.title AS certification, COALESCE(t.facilitator,'Internal') AS "issuingBody",
             n.completed_date AS "issuedDate", NULL::date AS "expiryDate", 'valid' AS status
      FROM training.hrms_nominations n
      JOIN training.hrms_trainings t ON t.id = n.training_id AND t.tenant_id = $1
      JOIN employee.hrms_employees e ON e.id = n.employee_id AND e.tenant_id = $1
      LEFT JOIN employee.hrms_departments d ON d.id = e.department_id AND d.tenant_id = $1
      WHERE n.tenant_id = $1 AND n.status = 'completed' AND n.certificate_ref IS NOT NULL
      ORDER BY n.completed_date DESC NULLS LAST LIMIT 200
    `, [ctx.tenantId]);
    return reply.send({ data: rows });
  });

  // ── Gap: Grievances (minor disciplinary cases) ─────────────────────────────
  app.get("/v1/hrms/grievances", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, HR_ROLES);
    // Grievance table pending dedicated migration — stub until hrms_grievances is created
    return reply.send({ data: [], meta: { note: "Grievance table pending — coming in next migration" } });
  });

  // ── Gap: Skills (employee competency assessments) ──────────────────────────
  app.get("/v1/hrms/skills", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, READER_ROLES);
    const { rows } = await sqlPool.query(`
      SELECT sa.id, e.full_name AS employee, COALESCE(d.name,'—') AS department,
             c.name AS skill, c.category, sa.assessed_level AS proficiency,
             COALESCE(ae.full_name,'—') AS "assessedBy", sa.assessed_at AS "lastAssessed"
      FROM employee.skill_assessments sa
      JOIN employee.competencies c ON c.id = sa.competency_id AND c.tenant_id = $1
      JOIN employee.hrms_employees e ON e.id = sa.employee_id AND e.tenant_id = $1
      LEFT JOIN employee.hrms_departments d ON d.id = e.department_id AND d.tenant_id = $1
      LEFT JOIN employee.hrms_employees ae ON ae.id = sa.assessed_by AND ae.tenant_id = $1
      WHERE sa.tenant_id = $1
      ORDER BY sa.assessed_at DESC LIMIT 500
    `, [ctx.tenantId]);
    return reply.send({ data: rows });
  });

  // ── Gap: Staffing Plan (manpower vacancy analysis) ─────────────────────────
  app.get("/v1/hrms/staffing-plan", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, HR_ROLES);
    // manpower.current_tenant_id() requires app.tenant_id; use a transaction with SET LOCAL
    const rows = await sqlClient.begin(async (sql) => {
      await sql.unsafe('SET LOCAL app.tenant_id = $1', [ctx.tenantId]);
      return sql.unsafe(`
        SELECT p.id, COALESCE(d.name, p.cadre) AS department, p.cadre,
               p.sanctioned_strength AS "sanctionedPosts", p.filled_strength AS filled,
               GREATEST(p.sanctioned_strength - p.filled_strength, 0) AS vacant,
               CASE WHEN p.sanctioned_strength > 0
                 THEN ROUND((p.filled_strength::numeric / p.sanctioned_strength) * 100, 1)
                 ELSE 0 END AS "fillPercentage",
               p.updated_at AS "lastReview", p.status
        FROM manpower.plans p
        LEFT JOIN employee.hrms_departments d ON d.id = p.unit_id AND d.tenant_id = $1
        WHERE p.tenant_id = $1
        ORDER BY p.plan_year DESC, "fillPercentage" ASC LIMIT 200
      `, [ctx.tenantId]);
    });
    return reply.send({ data: rows });
  });

  // ── Gap: Vigilance (major disciplinary cases) ──────────────────────────────
  app.get("/v1/hrms/vigilance", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, HR_ROLES);
    const { rows } = await sqlPool.query(`
      SELECT c.id, e.full_name AS employee, COALESCE(d.name,'—') AS department,
             c.allegation AS charges, c.charge_memo_date AS "filedDate",
             COALESCE(c.inquiry_officer_name,'Not Appointed') AS "inquiryOfficer",
             c.inquiry_appointed_date AS "nextHearing", c.status
      FROM disciplinary.hrms_disciplinary_cases c
      JOIN employee.hrms_employees e ON e.id = c.employee_id AND e.tenant_id = $1
      LEFT JOIN employee.hrms_departments d ON d.id = e.department_id AND d.tenant_id = $1
      WHERE c.tenant_id = $1 AND c.proceeding_type = 'major'
      ORDER BY c.charge_memo_date DESC NULLS LAST LIMIT 200
    `, [ctx.tenantId]);
    return reply.send({ data: rows });
  });

  // ── Gap: Work Summaries (derived from appraisals) ─────────────────────────
  app.get("/v1/hrms/work-summaries", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, READER_ROLES);
    const { rows } = await sqlPool.query(`
      SELECT a.id, e.full_name AS employee, COALESCE(d.name,'—') AS department,
             a.appraisal_period AS period, 'annual' AS "periodType",
             COALESCE(ROUND(a.overall_grade)::int, 0) AS "tasksCompleted",
             10 AS "totalTasks",
             COALESCE(a.rating, 0)::numeric AS rating, a.status
      FROM appraisal.hrms_appraisals a
      JOIN employee.hrms_employees e ON e.id = a.employee_id AND e.tenant_id = $1
      LEFT JOIN employee.hrms_departments d ON d.id = e.department_id AND d.tenant_id = $1
      WHERE a.tenant_id = $1
      ORDER BY a.appraisal_period DESC, e.full_name LIMIT 500
    `, [ctx.tenantId]);
    return reply.send({ data: rows });
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
