import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { resolveContext, HttpError } from "../../shared/context.js";
import { sqlPool as sqlClient } from "../../shared/db.js";

/**
 * Pulse Surveys — quick anonymous engagement check-ins.
 * Goals / OKR — personal and team goal tracking with check-ins.
 * Leaderboard — gamified recognition with points and ranks.
 */

const pulseCreateSchema = z.object({
  question: z.string().min(5).max(300),
  category: z.enum(["engagement", "culture", "workload", "growth", "wellbeing"]).optional(),
  anonymous: z.boolean().optional(),
  expiresAt: z.string().datetime().optional(),
});

const pulseRespondSchema = z.object({
  score: z.number().int().min(1).max(5),
  comment: z.string().max(500).optional(),
});

const goalCreateSchema = z.object({
  title: z.string().min(3).max(200),
  description: z.string().max(1000).optional(),
  category: z.enum(["individual", "team", "organization"]).optional(),
  keyResults: z.array(z.object({
    title: z.string(),
    targetValue: z.number(),
    currentValue: z.number().optional(),
    unit: z.string().optional(),
  })).optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  period: z.string().max(20).optional(),
  parentGoalId: z.string().uuid().optional(),
});

const goalCheckinSchema = z.object({
  progress: z.number().int().min(0).max(100),
  note: z.string().max(500).optional(),
});

export async function pulseGoalsRoutes(app: FastifyInstance): Promise<void> {

  // ═══════════════════════════════════════════════════════════════════════════
  // PULSE SURVEYS
  // ═══════════════════════════════════════════════════════════════════════════

  /** POST /v1/hrms/pulse-surveys — create a pulse survey (HR admin) */
  app.post("/v1/hrms/pulse-surveys", async (req, reply) => {
    const ctx = resolveContext(req);
    const body = pulseCreateSchema.parse(req.body);
    const id = randomUUID();

    await sqlClient.query(
      `INSERT INTO hrms.pulse_surveys (id, tenant_id, question, category, anonymous, created_by, created_at, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7)`,
      [id, ctx.tenantId, body.question, body.category ?? "engagement", body.anonymous ?? true, ctx.actorId, body.expiresAt ?? null],
    );

    return reply.code(201).send({ id, status: "created" });
  });

  /** GET /v1/hrms/pulse-surveys — list active surveys for current employee */
  app.get("/v1/hrms/pulse-surveys", async (req, reply) => {
    const ctx = resolveContext(req);

    const rows = await sqlClient.query(
      `SELECT s.id, s.question, s.category, s.anonymous, s.created_at,
              (SELECT COUNT(*) FROM hrms.pulse_responses r WHERE r.survey_id = s.id) AS response_count,
              EXISTS(SELECT 1 FROM hrms.pulse_responses r WHERE r.survey_id = s.id AND r.respondent_id = $2) AS already_responded
       FROM hrms.pulse_surveys s
       WHERE s.tenant_id = $1 AND s.is_active = true AND (s.expires_at IS NULL OR s.expires_at > NOW())
       ORDER BY s.created_at DESC LIMIT 20`,
      [ctx.tenantId, ctx.actorId],
    );

    return reply.send({ data: rows.rows });
  });

  /** POST /v1/hrms/pulse-surveys/:id/respond — submit pulse response */
  app.post("/v1/hrms/pulse-surveys/:id/respond", async (req, reply) => {
    const ctx = resolveContext(req);
    const { id } = req.params as { id: string };
    const body = pulseRespondSchema.parse(req.body);

    // Check survey exists and is active
    const survey = await sqlClient.query(
      `SELECT id FROM hrms.pulse_surveys WHERE id = $1 AND tenant_id = $2 AND is_active = true`,
      [id, ctx.tenantId],
    );
    if (survey.rowCount === 0) throw new HttpError(404, "NOT_FOUND", "Survey not found");

    // Upsert response (one per person)
    await sqlClient.query(
      `INSERT INTO hrms.pulse_responses (tenant_id, survey_id, respondent_id, score, comment, responded_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (survey_id, respondent_id) DO UPDATE SET score = $4, comment = $5, responded_at = NOW()`,
      [ctx.tenantId, id, ctx.actorId, body.score, body.comment ?? null],
    );

    // Award leaderboard points for responding
    await sqlClient.query(
      `INSERT INTO hrms.leaderboard_points (tenant_id, employee_id, points, reason, source_id, awarded_at)
       VALUES ($1, $2, 5, 'survey_responded', $3, NOW())`,
      [ctx.tenantId, ctx.actorId, id],
    );

    return reply.send({ status: "submitted" });
  });

  /** GET /v1/hrms/pulse-surveys/:id/results — survey results (aggregated) */
  app.get("/v1/hrms/pulse-surveys/:id/results", async (req, reply) => {
    const ctx = resolveContext(req);
    const { id } = req.params as { id: string };

    const stats = await sqlClient.query(
      `SELECT COUNT(*) AS total, AVG(score)::numeric(3,1) AS avg_score,
              COUNT(CASE WHEN score >= 4 THEN 1 END) AS positive,
              COUNT(CASE WHEN score <= 2 THEN 1 END) AS negative
       FROM hrms.pulse_responses WHERE survey_id = $1 AND tenant_id = $2`,
      [id, ctx.tenantId],
    );

    const distribution = await sqlClient.query(
      `SELECT score, COUNT(*) AS count FROM hrms.pulse_responses
       WHERE survey_id = $1 AND tenant_id = $2 GROUP BY score ORDER BY score`,
      [id, ctx.tenantId],
    );

    return reply.send({
      surveyId: id,
      total: Number(stats.rows[0]?.total ?? 0),
      avgScore: Number(stats.rows[0]?.avg_score ?? 0),
      positive: Number(stats.rows[0]?.positive ?? 0),
      negative: Number(stats.rows[0]?.negative ?? 0),
      distribution: distribution.rows,
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // GOALS / OKR
  // ═══════════════════════════════════════════════════════════════════════════

  /** POST /v1/hrms/goals — create a goal */
  app.post("/v1/hrms/goals", async (req, reply) => {
    const ctx = resolveContext(req);
    const body = goalCreateSchema.parse(req.body);
    const id = randomUUID();
    const now = new Date().toISOString();

    await sqlClient.query(
      `INSERT INTO hrms.goals (id, tenant_id, employee_id, title, description, category, key_results, due_date, period, parent_goal_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11)`,
      [id, ctx.tenantId, ctx.actorId, body.title, body.description ?? "", body.category ?? "individual",
       JSON.stringify(body.keyResults ?? []), body.dueDate ?? null, body.period ?? null, body.parentGoalId ?? null, now],
    );

    return reply.code(201).send({ id, status: "created" });
  });

  /** GET /v1/hrms/goals — list my goals */
  app.get("/v1/hrms/goals", async (req, reply) => {
    const ctx = resolveContext(req);
    const status = (req.query as any)?.status ?? "active";

    const rows = await sqlClient.query(
      `SELECT id, title, description, category, key_results, progress, status, due_date, period, created_at, updated_at
       FROM hrms.goals
       WHERE tenant_id = $1 AND employee_id = $2 AND ($3 = 'all' OR status = $3)
       ORDER BY created_at DESC`,
      [ctx.tenantId, ctx.actorId, status],
    );

    return reply.send({
      data: rows.rows.map((r: any) => ({
        ...r,
        keyResults: r.key_results,
        dueDate: r.due_date,
      })),
    });
  });

  /** POST /v1/hrms/goals/:id/checkin — log progress check-in */
  app.post("/v1/hrms/goals/:id/checkin", async (req, reply) => {
    const ctx = resolveContext(req);
    const { id } = req.params as { id: string };
    const body = goalCheckinSchema.parse(req.body);

    // Verify ownership
    const goal = await sqlClient.query(
      `SELECT id FROM hrms.goals WHERE id = $1 AND tenant_id = $2 AND employee_id = $3`,
      [id, ctx.tenantId, ctx.actorId],
    );
    if (goal.rowCount === 0) throw new HttpError(404, "NOT_FOUND", "Goal not found");

    // Insert check-in
    await sqlClient.query(
      `INSERT INTO hrms.goal_checkins (goal_id, tenant_id, employee_id, progress, note, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())`,
      [id, ctx.tenantId, ctx.actorId, body.progress, body.note ?? ""],
    );

    // Update goal progress
    const newStatus = body.progress >= 100 ? "completed" : "active";
    await sqlClient.query(
      `UPDATE hrms.goals SET progress = $1, status = $2, updated_at = NOW() WHERE id = $3`,
      [body.progress, newStatus, id],
    );

    // Award points for completion
    if (body.progress >= 100) {
      await sqlClient.query(
        `INSERT INTO hrms.leaderboard_points (tenant_id, employee_id, points, reason, source_id, awarded_at)
         VALUES ($1, $2, 50, 'goal_completed', $3, NOW())`,
        [ctx.tenantId, ctx.actorId, id],
      );
    }

    return reply.send({ status: "checked_in", progress: body.progress });
  });

  /** GET /v1/hrms/goals/:id/checkins — list check-in history */
  app.get("/v1/hrms/goals/:id/checkins", async (req, reply) => {
    const ctx = resolveContext(req);
    const { id } = req.params as { id: string };

    const rows = await sqlClient.query(
      `SELECT id, progress, note, created_at FROM hrms.goal_checkins
       WHERE goal_id = $1 AND tenant_id = $2 ORDER BY created_at DESC`,
      [id, ctx.tenantId],
    );

    return reply.send({ data: rows.rows });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // GAMIFIED LEADERBOARD
  // ═══════════════════════════════════════════════════════════════════════════

  /** GET /v1/hrms/leaderboard — ranked employees by recognition points */
  app.get("/v1/hrms/leaderboard", async (req, reply) => {
    const ctx = resolveContext(req);
    const period = (req.query as any)?.period ?? "month"; // month, quarter, year, all

    let dateFilter = "";
    if (period === "month") dateFilter = "AND lp.awarded_at > NOW() - INTERVAL '30 days'";
    else if (period === "quarter") dateFilter = "AND lp.awarded_at > NOW() - INTERVAL '90 days'";
    else if (period === "year") dateFilter = "AND lp.awarded_at > NOW() - INTERVAL '365 days'";

    const rows = await sqlClient.query(
      `SELECT e.id, e.first_name, e.last_name, e.department, e.designation, e.photo_url,
              COALESCE(SUM(lp.points), 0)::int AS total_points
       FROM hrms.employees e
       LEFT JOIN hrms.leaderboard_points lp ON lp.employee_id = e.id AND lp.tenant_id = e.tenant_id ${dateFilter}
       WHERE e.tenant_id = $1 AND e.status = 'active'
       GROUP BY e.id, e.first_name, e.last_name, e.department, e.designation, e.photo_url
       HAVING COALESCE(SUM(lp.points), 0) > 0
       ORDER BY total_points DESC
       LIMIT 50`,
      [ctx.tenantId],
    );

    const leaderboard = rows.rows.map((r: any, idx: number) => ({
      rank: idx + 1,
      id: r.id,
      name: `${r.first_name} ${r.last_name}`.trim(),
      department: r.department,
      designation: r.designation,
      photoUrl: r.photo_url,
      totalPoints: r.total_points,
      badge: getBadge(r.total_points),
    }));

    // Get my rank
    const myPoints = await sqlClient.query(
      `SELECT COALESCE(SUM(points), 0)::int AS total FROM hrms.leaderboard_points
       WHERE tenant_id = $1 AND employee_id = $2 ${dateFilter}`,
      [ctx.tenantId, ctx.actorId],
    );

    return reply.send({
      data: leaderboard,
      myPoints: myPoints.rows[0]?.total ?? 0,
      period,
    });
  });

  /** GET /v1/hrms/leaderboard/my-points — my points breakdown */
  app.get("/v1/hrms/leaderboard/my-points", async (req, reply) => {
    const ctx = resolveContext(req);

    const breakdown = await sqlClient.query(
      `SELECT reason, SUM(points)::int AS total, COUNT(*)::int AS count
       FROM hrms.leaderboard_points
       WHERE tenant_id = $1 AND employee_id = $2
       GROUP BY reason ORDER BY total DESC`,
      [ctx.tenantId, ctx.actorId],
    );

    const total = await sqlClient.query(
      `SELECT COALESCE(SUM(points), 0)::int AS total FROM hrms.leaderboard_points
       WHERE tenant_id = $1 AND employee_id = $2`,
      [ctx.tenantId, ctx.actorId],
    );

    return reply.send({
      totalPoints: total.rows[0]?.total ?? 0,
      badge: getBadge(total.rows[0]?.total ?? 0),
      breakdown: breakdown.rows,
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // AI CHATBOT (Simple NLU — pattern matching for common HR queries)
  // ═══════════════════════════════════════════════════════════════════════════

  /** POST /v1/hrms/assistant — AI-powered HR assistant */
  app.post("/v1/hrms/assistant", async (req, reply) => {
    const ctx = resolveContext(req);
    const { message } = req.body as { message?: string };
    if (!message || message.trim().length < 2) {
      throw new HttpError(400, "INVALID_INPUT", "Message is required");
    }

    const query = message.toLowerCase().trim();
    let response: { text: string; data?: any; action?: string } | null = null;

    // ─── Leave balance query ──────────────────────────────────────────
    if (query.includes("leave") && (query.includes("balance") || query.includes("how much") || query.includes("how many"))) {
      const bal = await sqlClient.query(
        `SELECT leave_type_code, leave_type_name, total_days, balance_days
         FROM hrms.leave_allocations
         WHERE tenant_id = $1 AND employee_id = (SELECT id FROM hrms.employees WHERE user_id = $1 AND tenant_id = $2 LIMIT 1)`,
        [ctx.actorId, ctx.tenantId],
      );
      if (bal.rowCount && bal.rowCount > 0) {
        const summary = bal.rows.map((r: any) => `${r.leave_type_name}: ${r.balance_days}/${r.total_days} days`).join("\n");
        response = { text: `Here's your leave balance:\n\n${summary}`, data: bal.rows, action: "show_leave_balance" };
      } else {
        response = { text: "I couldn't find your leave allocation. Please check with HR." };
      }
    }
    // ─── Payslip query ────────────────────────────────────────────────
    else if (query.includes("salary") || query.includes("payslip") || query.includes("pay slip") || query.includes("net pay")) {
      response = { text: "You can view your latest payslip in the Payslips section. Would you like me to navigate there?", action: "navigate_payslips" };
    }
    // ─── Holiday query ────────────────────────────────────────────────
    else if (query.includes("holiday") || query.includes("next holiday") || query.includes("public holiday")) {
      const holidays = await sqlClient.query(
        `SELECT name, date, type FROM hrms.holidays
         WHERE tenant_id = $1 AND date >= CURRENT_DATE
         ORDER BY date LIMIT 3`,
        [ctx.tenantId],
      );
      if (holidays.rowCount && holidays.rowCount > 0) {
        const list = holidays.rows.map((h: any) => `• ${h.name} — ${h.date}`).join("\n");
        response = { text: `Upcoming holidays:\n\n${list}`, data: holidays.rows };
      } else {
        response = { text: "No upcoming holidays found in the calendar." };
      }
    }
    // ─── Attendance query ─────────────────────────────────────────────
    else if (query.includes("attendance") || query.includes("present") || query.includes("absent")) {
      response = { text: "Your attendance records are available in the Attendance section. You can also mark attendance via Geo Check-in.", action: "navigate_attendance" };
    }
    // ─── Manager / reporting ──────────────────────────────────────────
    else if (query.includes("manager") || query.includes("reporting to") || query.includes("who is my")) {
      const emp = await sqlClient.query(
        `SELECT reporting_to FROM hrms.employees WHERE user_id = $1 AND tenant_id = $2`,
        [ctx.actorId, ctx.tenantId],
      );
      if (emp.rows[0]?.reporting_to) {
        const mgr = await sqlClient.query(
          `SELECT first_name, last_name, designation FROM hrms.employees WHERE id = $1`,
          [emp.rows[0].reporting_to],
        );
        if (mgr.rows[0]) {
          response = { text: `Your reporting manager is ${mgr.rows[0].first_name} ${mgr.rows[0].last_name} (${mgr.rows[0].designation}).` };
        }
      }
      response = response ?? { text: "I couldn't find your reporting manager details." };
    }
    // ─── Policy / HR help ─────────────────────────────────────────────
    else if (query.includes("policy") || query.includes("rules") || query.includes("how to apply")) {
      response = { text: "You can find all HR policies in the Documents section. For leave policies, go to Leave > Policy Info. For specific questions, please raise a ticket with HR.", action: "navigate_documents" };
    }
    // ─── Loan status ──────────────────────────────────────────────────
    else if (query.includes("loan") || query.includes("advance") || query.includes("emi")) {
      response = { text: "Your loan and advance details are in the Loans & Advances section. I can navigate you there.", action: "navigate_loans" };
    }
    // ─── Greeting ─────────────────────────────────────────────────────
    else if (query.includes("hello") || query.includes("hi") || query.includes("hey")) {
      response = { text: "Hello! 👋 I'm your HR assistant. I can help you with:\n\n• Leave balance\n• Payslip info\n• Upcoming holidays\n• Attendance status\n• Your reporting manager\n• HR policies\n• Loan/advance status\n\nJust ask!" };
    }
    // ─── Fallback ─────────────────────────────────────────────────────
    else {
      response = { text: "I'm not sure I understand that. I can help with: leave balance, payslips, holidays, attendance, manager info, HR policies, and loan status. Try asking something like \"How much casual leave do I have?\"" };
    }

    return reply.send(response);
  });
}

function getBadge(points: number): string {
  if (points >= 500) return "diamond";
  if (points >= 300) return "platinum";
  if (points >= 200) return "gold";
  if (points >= 100) return "silver";
  if (points >= 50) return "bronze";
  return "starter";
}
