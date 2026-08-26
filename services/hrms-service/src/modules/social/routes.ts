import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { z, ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { cache, queue } from "../../shared/infra.js";
import { sqlClient } from "../../shared/db.js";
import { withRawTenantGuc } from "@civitasone/db";

/**
 * Social Feed Module — peer recognition (kudos), birthdays, new joinees,
 * announcements, travel requests, and expense claims.
 *
 * Tables live in employee.hrms_social_* / employee.hrms_push_devices
 * (migration 0115_social_feed.sql) and claims.hrms_travel_requests /
 * claims.hrms_expense_claims (same migration; claims schema chosen to match
 * the shape of sibling claims.hrms_cea_claims / claims.hrms_ltc_claims).
 *
 * employee.hrms_employees, employee.hrms_social_*, claims.hrms_travel_requests,
 * claims.hrms_expense_claims and employee.hrms_push_devices all have RLS
 * ENABLEd and FORCEd, and this module talks to `sqlClient` directly via the
 * classic `pg` query(text, params) shape (no Drizzle schema attached here, so
 * there is no db.transaction() — where wrapWithTenantGuc injects
 * app.tenant_id — anywhere in the call path). Without this, every query
 * below ran with no GUC set and the connecting role (`hrms_svc`, NOBYPASSRLS
 * non-superuser) got zero rows back / a row-security violation on write,
 * silently: RLS fails CLOSED. This affected every handler in this file, not
 * just the two that were reported 500ing — birthdays and the org chart, for
 * example, queried employee.hrms_employees the same unwrapped way and simply
 * returned empty results with no error. See @civitasone/db's
 * withRawTenantGuc for the shared fix (already applied the same way in this
 * service's medical and workforce-planning modules).
 */
function withTenantGuc<T>(
  tenantId: string,
  fn: (pool: {
    query<R = any>(text: string, params?: readonly unknown[]): Promise<{ rows: R[]; rowCount: number }>;
  }) => Promise<T>,
): Promise<T> {
  return withRawTenantGuc(sqlClient, tenantId, async (tx) => {
    // Bridges postgres-js's tagged-template `tx` back to the classic
    // `query(text, params)` / `{ rows, rowCount }` shape this file already
    // uses everywhere, exactly like shared/db.ts's own `sqlPool` bridges the
    // top-level (unscoped) client — same logic, just scoped to this
    // GUC-bearing transaction instead of the pool.
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

// ─── Validation Schemas ─────────────────────────────────────────────────────

const kudosCreateSchema = z.object({
  receiverId: z.string().uuid(),
  badge: z.enum(["star", "rocket", "heart", "trophy", "fire", "lightning", "thumbsup"]),
  message: z.string().min(5).max(500),
});

const announcementCreateSchema = z.object({
  title: z.string().min(3).max(200),
  body: z.string().min(10).max(5000),
  category: z.enum(["general", "policy", "event", "achievement", "safety", "training"]),
  pinned: z.boolean().optional(),
  expiresAt: z.string().datetime().optional(),
});

const travelRequestSchema = z.object({
  purpose: z.string().min(5).max(500),
  destination: z.string().min(2).max(200),
  fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  advanceRequired: z.number().int().min(0).optional(),
  mode: z.enum(["air", "rail", "road", "own_vehicle"]).optional(),
});

const expenseClaimSchema = z.object({
  category: z.enum(["travel", "food", "accommodation", "transport", "medical", "stationery", "communication", "other"]),
  amount: z.number().int().min(1), // paise
  description: z.string().max(500).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  receiptKey: z.string().optional(),
  travelRequestId: z.string().uuid().optional(),
});

// ─── Routes ─────────────────────────────────────────────────────────────────

export async function socialRoutes(app: FastifyInstance): Promise<void> {
  // ─── KUDOS / PEER RECOGNITION ───────────────────────────────────────────

  /** POST /v1/hrms/kudos — give kudos to a colleague */
  app.post("/v1/hrms/kudos", async (req, reply) => {
    const ctx = resolveContext(req);
    const body = kudosCreateSchema.parse(req.body);
    const id = randomUUID();
    const now = new Date().toISOString();

    const { receiverName, giverName } = await withTenantGuc(ctx.tenantId, async (pool) => {
      // Get receiver name for feed display
      const receiverRow = await pool.query(
        `SELECT first_name, last_name, employee_code FROM employee.hrms_employees WHERE id = $1 AND tenant_id = $2`,
        [body.receiverId, ctx.tenantId],
      );
      const receiver = receiverRow.rows[0];
      if (!receiver) throw new HttpError(404, "RECEIVER_NOT_FOUND", "Employee not found");

      const receiverName = `${receiver.first_name} ${receiver.last_name}`.trim();

      // Get giver name
      const giverRow = await pool.query(
        `SELECT first_name, last_name FROM employee.hrms_employees WHERE user_id = $1 AND tenant_id = $2`,
        [ctx.actorId, ctx.tenantId],
      );
      const giverName = giverRow.rows[0]
        ? `${giverRow.rows[0].first_name} ${giverRow.rows[0].last_name}`.trim()
        : "Unknown";

      await pool.query(
        `INSERT INTO employee.hrms_social_kudos (id, tenant_id, giver_id, receiver_id, giver_name, receiver_name, badge, message, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [id, ctx.tenantId, ctx.actorId, body.receiverId, giverName, receiverName, body.badge, body.message, now],
      );

      return { receiverName, giverName };
    });

    // Emit notification event
    await queue.publish("notification.send", {
      messageId: randomUUID(),
      type: "hrms.kudos.received",
      schemaVersion: "1.0",
      tenantId: ctx.tenantId,
      correlationId: ctx.correlationId,
      actorId: ctx.actorId,
      timestamp: now,
      payload: {
        templateId: "00000000-0000-4000-8001-000000000000",
        recipient: body.receiverId,
        recipientId: body.receiverId,
        channel: "push",
        eventType: "hrms.kudos.received",
        variables: { giverName, badge: body.badge, message: body.message },
      },
    });

    // Invalidate feed cache
    await cache.invalidate(`social:feed:${ctx.tenantId}`);

    return reply.code(201).send({ id, status: "created" });
  });

  /** GET /v1/hrms/kudos/feed — organization-wide kudos feed */
  app.get("/v1/hrms/kudos/feed", async (req, reply) => {
    const ctx = resolveContext(req);
    const limit = Math.min(Number((req.query as any)?.limit ?? 50), 100);

    const { rows, myStats } = await withTenantGuc(ctx.tenantId, async (pool) => {
      const rows = await pool.query(
        `SELECT id, giver_id, receiver_id, giver_name, receiver_name, badge, message, created_at,
                (SELECT COUNT(*) FROM employee.hrms_social_kudos_reactions r WHERE r.kudos_id = k.id) AS reactions
         FROM employee.hrms_social_kudos k
         WHERE tenant_id = $1
         ORDER BY created_at DESC
         LIMIT $2`,
        [ctx.tenantId, limit],
      );

      // Count for current user
      const myStats = await pool.query(
        `SELECT
           (SELECT COUNT(*) FROM employee.hrms_social_kudos WHERE receiver_id = $1 AND tenant_id = $2) AS received,
           (SELECT COUNT(*) FROM employee.hrms_social_kudos WHERE giver_id = $1 AND tenant_id = $2) AS given`,
        [ctx.actorId, ctx.tenantId],
      );

      return { rows, myStats };
    });

    return reply.send({
      data: rows.rows.map((r: any) => ({
        id: r.id,
        giverId: r.giver_id,
        receiverId: r.receiver_id,
        giverName: r.giver_name,
        receiverName: r.receiver_name,
        badge: r.badge,
        message: r.message,
        createdAt: r.created_at,
        reactions: Number(r.reactions),
      })),
      myReceived: Number(myStats.rows[0]?.received ?? 0),
      myGiven: Number(myStats.rows[0]?.given ?? 0),
    });
  });

  // ─── SOCIAL FEED (COMBINED) ─────────────────────────────────────────────

  /** GET /v1/hrms/social/feed — combined feed: kudos + birthdays + new joinees + announcements */
  app.get("/v1/hrms/social/feed", async (req, reply) => {
    const ctx = resolveContext(req);
    const limit = Math.min(Number((req.query as any)?.limit ?? 30), 50);
    const feed: any[] = [];

    const { kudos, birthdays, newJoinees, announcements } = await withTenantGuc(ctx.tenantId, async (pool) => {
      // 1. Recent kudos (last 7 days)
      const kudos = await pool.query(
        `SELECT id, giver_name, receiver_name, badge, message, created_at
         FROM employee.hrms_social_kudos WHERE tenant_id = $1 AND created_at > NOW() - INTERVAL '7 days'
         ORDER BY created_at DESC LIMIT 10`,
        [ctx.tenantId],
      );

      // 2. Today's birthdays
      const today = new Date();
      const mm = String(today.getMonth() + 1).padStart(2, "0");
      const dd = String(today.getDate()).padStart(2, "0");
      const birthdays = await pool.query(
        `SELECT id, first_name, last_name, department, designation, photo_url
         FROM employee.hrms_employees
         WHERE tenant_id = $1 AND status = 'active'
           AND EXTRACT(MONTH FROM date_of_birth) = $2
           AND EXTRACT(DAY FROM date_of_birth) = $3`,
        [ctx.tenantId, Number(mm), Number(dd)],
      );

      // 3. New joinees (last 30 days)
      const newJoinees = await pool.query(
        `SELECT id, first_name, last_name, department, designation, joining_date, photo_url
         FROM employee.hrms_employees
         WHERE tenant_id = $1 AND status = 'active'
           AND joining_date > NOW() - INTERVAL '30 days'
         ORDER BY joining_date DESC LIMIT 5`,
        [ctx.tenantId],
      );

      // 4. Announcements
      const announcements = await pool.query(
        `SELECT id, title, body, category, pinned, created_by_name, created_at
         FROM employee.hrms_social_announcements
         WHERE tenant_id = $1 AND (expires_at IS NULL OR expires_at > NOW())
         ORDER BY pinned DESC, created_at DESC LIMIT 10`,
        [ctx.tenantId],
      );

      return { kudos, birthdays, newJoinees, announcements };
    });

    for (const k of kudos.rows) {
      feed.push({ type: "kudos", ...k, createdAt: k.created_at });
    }

    const today = new Date();
    for (const b of birthdays.rows) {
      feed.push({
        type: "birthday",
        id: b.id,
        name: `${b.first_name} ${b.last_name}`.trim(),
        department: b.department,
        designation: b.designation,
        photoUrl: b.photo_url,
        createdAt: today.toISOString(),
      });
    }

    for (const j of newJoinees.rows) {
      feed.push({
        type: "new_joinee",
        id: j.id,
        name: `${j.first_name} ${j.last_name}`.trim(),
        department: j.department,
        designation: j.designation,
        joiningDate: j.joining_date,
        photoUrl: j.photo_url,
        createdAt: j.joining_date,
      });
    }

    for (const a of announcements.rows) {
      feed.push({
        type: "announcement",
        id: a.id,
        title: a.title,
        body: a.body,
        category: a.category,
        pinned: a.pinned,
        author: a.created_by_name,
        createdAt: a.created_at,
      });
    }

    // Sort combined feed by date descending
    feed.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return reply.send({ data: feed.slice(0, limit) });
  });

  // ─── ANNOUNCEMENTS ──────────────────────────────────────────────────────

  /** POST /v1/hrms/announcements — create an org announcement (HR admin only) */
  app.post("/v1/hrms/announcements", async (req, reply) => {
    const ctx = resolveContext(req);
    const body = announcementCreateSchema.parse(req.body);
    const id = randomUUID();
    const now = new Date().toISOString();

    // Author-name lookup is best-effort and deliberately kept OUTSIDE the
    // write below (its own withTenantGuc call) and fault-tolerant: this
    // already had a not-found fallback to "Admin", now extended to also
    // cover a thrown lookup error, since this environment's
    // employee.hrms_employees has drifted from the column names this lookup
    // was written against (see PR notes — a separate, pre-existing bug, out
    // of scope here). The announcement itself must still be creatable
    // either way.
    let authorName = "Admin";
    try {
      authorName = await withTenantGuc(ctx.tenantId, async (pool) => {
        const authorRow = await pool.query(
          `SELECT first_name, last_name FROM employee.hrms_employees WHERE user_id = $1 AND tenant_id = $2`,
          [ctx.actorId, ctx.tenantId],
        );
        return authorRow.rows[0]
          ? `${authorRow.rows[0].first_name} ${authorRow.rows[0].last_name}`.trim()
          : "Admin";
      });
    } catch (err) {
      req.log.warn({ err }, "announcement author lookup failed; falling back to 'Admin'");
    }

    await withTenantGuc(ctx.tenantId, (pool) => pool.query(
      `INSERT INTO employee.hrms_social_announcements (id, tenant_id, title, body, category, pinned, created_by, created_by_name, created_at, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [id, ctx.tenantId, body.title, body.body, body.category, body.pinned ?? false, ctx.actorId, authorName, now, body.expiresAt ?? null],
    ));

    await cache.invalidate(`social:feed:${ctx.tenantId}`);

    return reply.code(201).send({ id, status: "created" });
  });

  /** GET /v1/hrms/announcements — list announcements */
  app.get("/v1/hrms/announcements", async (req, reply) => {
    const ctx = resolveContext(req);
    const rows = await withTenantGuc(ctx.tenantId, (pool) => pool.query(
      `SELECT id, title, body, category, pinned, created_by_name AS author, created_at AS "createdAt"
       FROM employee.hrms_social_announcements
       WHERE tenant_id = $1 AND (expires_at IS NULL OR expires_at > NOW())
       ORDER BY pinned DESC, created_at DESC LIMIT 50`,
      [ctx.tenantId],
    ));
    return reply.send({ data: rows.rows });
  });

  // ─── BIRTHDAYS ──────────────────────────────────────────────────────────

  /** GET /v1/hrms/birthdays/today — today's birthdays */
  app.get("/v1/hrms/birthdays/today", async (req, reply) => {
    const ctx = resolveContext(req);
    const today = new Date();
    const mm = today.getMonth() + 1;
    const dd = today.getDate();

    const rows = await withTenantGuc(ctx.tenantId, (pool) => pool.query(
      `SELECT id, first_name, last_name, department, designation, photo_url
       FROM employee.hrms_employees
       WHERE tenant_id = $1 AND status = 'active'
         AND EXTRACT(MONTH FROM date_of_birth) = $2
         AND EXTRACT(DAY FROM date_of_birth) = $3`,
      [ctx.tenantId, mm, dd],
    ));

    return reply.send({
      data: rows.rows.map((r: any) => ({
        id: r.id,
        name: `${r.first_name} ${r.last_name}`.trim(),
        department: r.department,
        designation: r.designation,
        photoUrl: r.photo_url,
      })),
    });
  });

  /** POST /v1/hrms/birthdays/:id/wish — send birthday wish */
  app.post("/v1/hrms/birthdays/:id/wish", async (req, reply) => {
    const ctx = resolveContext(req);
    const { id } = req.params as { id: string };
    const { message } = (req.body as any) ?? {};

    // Send push notification as birthday wish
    await queue.publish("notification.send", {
      messageId: randomUUID(),
      type: "hrms.birthday.wish",
      schemaVersion: "1.0",
      tenantId: ctx.tenantId,
      correlationId: ctx.correlationId,
      actorId: ctx.actorId,
      timestamp: new Date().toISOString(),
      payload: {
        templateId: "00000000-0000-4000-8001-000000000000",
        recipient: id,
        recipientId: id,
        channel: "push",
        eventType: "hrms.birthday.wish",
        variables: { message: message ?? "Happy Birthday! 🎂" },
      },
    });

    return reply.send({ status: "wish_sent" });
  });

  // ─── TRAVEL REQUESTS ────────────────────────────────────────────────────

  /** POST /v1/hrms/travel-requests — submit travel request for reporting manager approval */
  app.post("/v1/hrms/travel-requests", async (req, reply) => {
    const ctx = resolveContext(req);
    const body = travelRequestSchema.parse(req.body);
    const id = randomUUID();
    const now = new Date().toISOString();

    await withTenantGuc(ctx.tenantId, (pool) => pool.query(
      `INSERT INTO claims.hrms_travel_requests (id, tenant_id, employee_id, purpose, destination, from_date, to_date, advance_required, mode, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending', $10, $10)`,
      [id, ctx.tenantId, ctx.actorId, body.purpose, body.destination, body.fromDate, body.toDate, body.advanceRequired ?? 0, body.mode ?? "rail", now],
    ));

    // Reporting-manager lookup for the approval notification is best-effort
    // and deliberately kept OUTSIDE the write above (its own withTenantGuc
    // call, not the same transaction) and fault-tolerant: this environment's
    // employee.hrms_employees has drifted from the column names this lookup
    // was written against (see PR notes — a separate, pre-existing bug, out
    // of scope here), so it currently cannot succeed. The travel request
    // itself must still be created either way; only the notification is
    // allowed to silently no-op.
    let reportingTo: string | undefined;
    try {
      reportingTo = await withTenantGuc(ctx.tenantId, async (pool) => {
        const manager = await pool.query(
          `SELECT reporting_to FROM employee.hrms_employees WHERE user_id = $1 AND tenant_id = $2`,
          [ctx.actorId, ctx.tenantId],
        );
        return manager.rows[0]?.reporting_to as string | undefined;
      });
    } catch (err) {
      req.log.warn({ err }, "travel-request manager lookup failed; skipping approval notification");
    }

    if (reportingTo) {
      await queue.publish("notification.send", {
        messageId: randomUUID(),
        type: "hrms.travel.requested",
        schemaVersion: "1.0",
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        actorId: ctx.actorId,
        timestamp: now,
        payload: {
          templateId: "00000000-0000-4000-8001-000000000000",
          recipient: reportingTo,
          recipientId: reportingTo,
          channel: "push",
          eventType: "hrms.travel.requested",
          variables: { destination: body.destination, fromDate: body.fromDate, toDate: body.toDate },
        },
      });
    }

    return reply.code(202).send({ id, status: "pending" });
  });

  /** GET /v1/hrms/travel-requests — list my travel requests */
  app.get("/v1/hrms/travel-requests", async (req, reply) => {
    const ctx = resolveContext(req);
    const rows = await withTenantGuc(ctx.tenantId, (pool) => pool.query(
      `SELECT id, purpose, destination, from_date, to_date, advance_required, mode, status, created_at, approved_by, approved_at
       FROM claims.hrms_travel_requests
       WHERE tenant_id = $1 AND employee_id = $2
       ORDER BY created_at DESC`,
      [ctx.tenantId, ctx.actorId],
    ));
    return reply.send({ data: rows.rows });
  });

  /** PATCH /v1/hrms/travel-requests/:id/approve — reporting manager approves */
  app.patch("/v1/hrms/travel-requests/:id/approve", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ["manager", "hr_admin", "hr_officer", "super_admin"]);
    const { id } = req.params as { id: string };
    const now = new Date().toISOString();

    const employeeId = await withTenantGuc(ctx.tenantId, async (pool) => {
      // SoD: verify approver is not the submitter
      const check = await pool.query(
        `SELECT employee_id FROM claims.hrms_travel_requests WHERE id = $1 AND tenant_id = $2`,
        [id, ctx.tenantId],
      );
      if (check.rows[0]?.employee_id === ctx.actorId) {
        throw new HttpError(403, "SELF_APPROVAL", "Cannot approve your own travel request");
      }

      const result = await pool.query(
        `UPDATE claims.hrms_travel_requests SET status = 'approved', approved_by = $1, approved_at = $2, updated_at = $2
         WHERE id = $3 AND tenant_id = $4 AND status = 'pending' RETURNING employee_id`,
        [ctx.actorId, now, id, ctx.tenantId],
      );
      if (result.rowCount === 0) throw new HttpError(404, "NOT_FOUND", "Travel request not found or already processed");
      return result.rows[0].employee_id as string;
    });

    // Notify employee
    await queue.publish("notification.send", {
      messageId: randomUUID(),
      type: "hrms.travel.approved",
      schemaVersion: "1.0",
      tenantId: ctx.tenantId,
      correlationId: ctx.correlationId,
      actorId: ctx.actorId,
      timestamp: now,
      payload: {
        templateId: "00000000-0000-4000-8001-000000000000",
        recipient: employeeId,
        recipientId: employeeId,
        channel: "push",
        eventType: "hrms.travel.approved",
      },
    });

    return reply.send({ id, status: "approved" });
  });

  /** PATCH /v1/hrms/travel-requests/:id/reject — reporting manager rejects */
  app.patch("/v1/hrms/travel-requests/:id/reject", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ["manager", "hr_admin", "hr_officer", "super_admin"]);
    const { id } = req.params as { id: string };
    const { reason } = (req.body as any) ?? {};
    const now = new Date().toISOString();

    await withTenantGuc(ctx.tenantId, async (pool) => {
      const result = await pool.query(
        `UPDATE claims.hrms_travel_requests SET status = 'rejected', rejection_reason = $1, approved_by = $2, approved_at = $3, updated_at = $3
         WHERE id = $4 AND tenant_id = $5 AND status = 'pending' RETURNING employee_id`,
        [reason ?? "", ctx.actorId, now, id, ctx.tenantId],
      );
      if (result.rowCount === 0) throw new HttpError(404, "NOT_FOUND", "Travel request not found or already processed");
    });

    return reply.send({ id, status: "rejected" });
  });

  // ─── EXPENSE CLAIMS ─────────────────────────────────────────────────────

  /** POST /v1/hrms/expenses — submit expense claim */
  app.post("/v1/hrms/expenses", async (req, reply) => {
    const ctx = resolveContext(req);
    const body = expenseClaimSchema.parse(req.body);
    const id = randomUUID();
    const now = new Date().toISOString();

    await withTenantGuc(ctx.tenantId, (pool) => pool.query(
      `INSERT INTO claims.hrms_expense_claims (id, tenant_id, employee_id, category, amount, description, expense_date, receipt_key, travel_request_id, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending', $10, $10)`,
      [id, ctx.tenantId, ctx.actorId, body.category, body.amount, body.description ?? "", body.date, body.receiptKey ?? null, body.travelRequestId ?? null, now],
    ));

    return reply.code(202).send({ id, status: "pending" });
  });

  /** GET /v1/hrms/expenses — list my expense claims */
  app.get("/v1/hrms/expenses", async (req, reply) => {
    const ctx = resolveContext(req);
    const rows = await withTenantGuc(ctx.tenantId, (pool) => pool.query(
      `SELECT id, category, amount, description, expense_date AS date, receipt_key AS "receiptKey", status, created_at
       FROM claims.hrms_expense_claims
       WHERE tenant_id = $1 AND employee_id = $2
       ORDER BY created_at DESC`,
      [ctx.tenantId, ctx.actorId],
    ));
    return reply.send({ data: rows.rows });
  });

  /** PATCH /v1/hrms/expenses/:id/approve — approve expense claim */
  app.patch("/v1/hrms/expenses/:id/approve", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ["manager", "hr_admin", "finance_officer", "super_admin"]);
    const { id } = req.params as { id: string };
    const now = new Date().toISOString();

    await withTenantGuc(ctx.tenantId, async (pool) => {
      // SoD: verify approver is not the submitter
      const check = await pool.query(
        `SELECT employee_id FROM claims.hrms_expense_claims WHERE id = $1 AND tenant_id = $2`,
        [id, ctx.tenantId],
      );
      if (check.rows[0]?.employee_id === ctx.actorId) {
        throw new HttpError(403, "SELF_APPROVAL", "Cannot approve your own expense claim");
      }

      // NOTE: previously this UPDATE had no RETURNING / rowCount check, so
      // approving a nonexistent or already-processed claim silently
      // "succeeded" with 0 rows changed instead of 404ing — inconsistent
      // with the travel-requests approve/reject handlers just above, which
      // already do this correctly. Matched to that existing pattern.
      const result = await pool.query(
        `UPDATE claims.hrms_expense_claims SET status = 'approved', approved_by = $1, approved_at = $2, updated_at = $2
         WHERE id = $3 AND tenant_id = $4 AND status = 'pending' RETURNING id`,
        [ctx.actorId, now, id, ctx.tenantId],
      );
      if (result.rowCount === 0) throw new HttpError(404, "NOT_FOUND", "Expense claim not found or already processed");
    });

    return reply.send({ id, status: "approved" });
  });

  // ─── PUSH NOTIFICATION DEVICE REGISTRATION ──────────────────────────────

  /** POST /v1/hrms/devices/register — register FCM/APNs token for push notifications */
  app.post("/v1/hrms/devices/register", async (req, reply) => {
    const ctx = resolveContext(req);
    const { token, platform, deviceId } = req.body as { token: string; platform: string; deviceId: string };

    if (!token || !platform || !deviceId) {
      throw new HttpError(400, "INVALID_INPUT", "token, platform, and deviceId are required");
    }

    await withTenantGuc(ctx.tenantId, (pool) => pool.query(
      `INSERT INTO employee.hrms_push_devices (id, tenant_id, user_id, device_id, token, platform, registered_at, last_seen_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
       ON CONFLICT (tenant_id, user_id, device_id) DO UPDATE SET token = $5, last_seen_at = NOW()`,
      [randomUUID(), ctx.tenantId, ctx.actorId, deviceId, token, platform],
    ));

    return reply.send({ status: "registered" });
  });

  // ─── ORG CHART (ENHANCED) ───────────────────────────────────────────────

  /** GET /v1/hrms/orgchart — hierarchical org chart */
  app.get("/v1/hrms/orgchart", async (req, reply) => {
    const ctx = resolveContext(req);
    const rootId = (req.query as any)?.rootId;

    const rows = await withTenantGuc(ctx.tenantId, (pool) => pool.query(
      `SELECT id, first_name, last_name, designation, department, reporting_to, photo_url, employee_code
       FROM employee.hrms_employees
       WHERE tenant_id = $1 AND status = 'active'
       ORDER BY designation`,
      [ctx.tenantId],
    ));

    // Build tree
    const employees = rows.rows.map((r: any) => ({
      id: r.id,
      name: `${r.first_name} ${r.last_name}`.trim(),
      designation: r.designation,
      department: r.department,
      reportingTo: r.reporting_to,
      photoUrl: r.photo_url,
      employeeCode: r.employee_code,
      children: [] as any[],
    }));

    const map = new Map(employees.map((e) => [e.id, e]));
    const roots: any[] = [];

    for (const emp of employees) {
      if (emp.reportingTo && map.has(emp.reportingTo)) {
        map.get(emp.reportingTo)!.children.push(emp);
      } else {
        roots.push(emp);
      }
    }

    // If rootId specified, return subtree
    if (rootId && map.has(rootId)) {
      return reply.send({ data: map.get(rootId) });
    }

    return reply.send({ data: roots });
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })) });
    }
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId });
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId });
  });
}
