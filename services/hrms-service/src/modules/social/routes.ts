import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { z, ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { cache, queue } from "../../shared/infra.js";
import { sqlClient } from "../../shared/db.js";
import { withRawTenantGuc } from "@civitasone/db";
import { presignedGetUrl } from "@civitasone/storage";
import { writeAuditLog } from "../../shared/audit.js";

const HR_ROLES = ["hr_admin", "hr_officer", "super_admin"];
const ALL_ROLES = [...HR_ROLES, "manager", "employee"];
// GAP-HR-EXPENSES-02/03/04: who may approve/reject an expense claim, see its
// pending approvals queue, or fetch another employee's receipt. Matches the
// already-shipped PATCH .../approve route's role list exactly (this constant
// didn't exist before -- that route inlined the same four roles; extracted
// here so approve/reject/pending-scope/receipt can't drift from each other).
const EXPENSE_DECIDE_ROLES = ["manager", "hr_admin", "finance_officer", "super_admin"];

// GAP-HR-EXPENSES-SOD-01: unlike claims.hrms_travel_requests' approve/reject
// routes just above (GAP-HR-TRAVEL-01), which restrict a non-HR "manager" to
// their own direct reports via employee.hrms_employees.manager_id,
// expense-claim approve/reject/?scope=approvals/receipt previously only
// checked self-approval (SoD), not reporting-line -- a "manager" role holder
// could decide (and view the PII-bearing receipt of) ANY employee's expense
// claim tenant-wide, not just their own reports. This predated this change's
// own PR and was flagged there for a deliberate human decision rather than a
// silent carry-forward; closed here the same way GAP-HR-TRAVEL-01 was. A
// non-privileged "manager" is now scoped to their own direct reports via the
// same employee.hrms_employees.manager_id lookup; hr_admin/finance_officer/
// super_admin bypass unaffected.
//
// EXPENSE_BYPASS_ROLES is deliberately NOT this file's module-level HR_ROLES
// above: finance_officer isn't in HR_ROLES but must still bypass here (it IS
// an EXPENSE_DECIDE_ROLES member with legitimate tenant-wide authority), and
// hr_officer is in HR_ROLES but isn't an expense decider at all.
const EXPENSE_BYPASS_ROLES = EXPENSE_DECIDE_ROLES.filter((r) => r !== "manager");

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
 * there is no ORM-level transaction wrapper — where wrapWithTenantGuc injects
 * app.tenant_id — anywhere in the call path). Without this, every query
 * below ran with no GUC set and the connecting role (`hrms_svc`, NOBYPASSRLS
 * non-superuser) got zero rows back / a row-security violation on write,
 * silently: RLS fails CLOSED. This affected every handler in this file, not
 * just the two that were reported 500ing — birthdays and the org chart, for
 * example, queried employee.hrms_employees the same unwrapped way and simply
 * returned empty results with no error. See @civitasone/db's
 * withRawTenantGuc for the shared fix (already applied the same way in this
 * service's medical and workforce-planning modules).
 *
 * NOTE for the F3 leftover-CQRS guard test (tests/f3-leftover-hrms-cqrs.test.ts):
 * this file's writes are all raw pool.query(...)/tagged-template SQL, not
 * Drizzle ORM method calls, so the guard's regex never matched any of them —
 * the ONE line it used to flag here was this comment block's prose
 * mentioning the ORM transaction-wrapper method by name (spelled out as an
 * object-dot-method call), a false positive from regex-scanning comment
 * text, not a real leftover synchronous write. Rewording it (as above, and
 * avoiding spelling that name out verbatim anywhere in this file) is the
 * whole fix for this file; none of the kudos/announcement/travel-request/
 * expense-claim/device-registration writes were touched.
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

const birthdayWishSchema = z.object({
  message: z.string().min(1).max(200).optional(),
});

const expenseClaimSchema = z.object({
  category: z.enum(["travel", "food", "accommodation", "transport", "medical", "stationery", "communication", "other"]),
  amount: z.number().int().min(1), // paise
  description: z.string().max(500).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  receiptKey: z.string().optional(),
  travelRequestId: z.string().uuid().optional(),
});

// GAP-HR-EXPENSES-02: unlike travel-requests' reject (reason optional), an
// expense claim's reject requires one -- this is money leaving "Pending"
// with no further workflow step, so the reason is the only record of why.
const expenseRejectSchema = z.object({
  reason: z.string().trim().min(3, "Reason must be at least 3 characters").max(500),
});

const expenseListQuerySchema = z.object({
  // GAP-HR-EXPENSES-02/03: "approvals" lists OTHER employees' pending claims
  // for an approver to act on (GET /v1/hrms/expenses otherwise only ever
  // returns the caller's own claims -- see GAP-HR-EXPENSES-03). Named
  // "approvals" rather than travel-requests' "team" (GAP-HR-TRAVEL-01) for
  // historical reasons only -- as of GAP-HR-EXPENSES-SOD-01 a non-privileged
  // "manager" IS now scoped to their own direct reports here too (see
  // EXPENSE_BYPASS_ROLES' doc comment), same as travel-requests' "team".
  scope: z.enum(["approvals"]).optional(),
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
      // Get receiver name for feed display.
      // Audit: employee.hrms_employees has no first_name/last_name (only
      // full_name) and no user_id (only user_ref) -- this and every other
      // employee-name lookup in this file 500'd or silently no-op'd on the
      // real schema. See the social/feed handler below for the confirmed
      // live-verified root cause of the /hr/social-feed 500.
      const receiverRow = await pool.query(
        `SELECT full_name FROM employee.hrms_employees WHERE id = $1 AND tenant_id = $2`,
        [body.receiverId, ctx.tenantId],
      );
      const receiver = receiverRow.rows[0];
      if (!receiver) throw new HttpError(404, "RECEIVER_NOT_FOUND", "Employee not found");

      const receiverName = receiver.full_name;

      // Get giver name
      const giverRow = await pool.query(
        `SELECT full_name FROM employee.hrms_employees WHERE user_ref = $1 AND tenant_id = $2`,
        [ctx.actorId, ctx.tenantId],
      );
      const giverName = giverRow.rows[0]?.full_name ?? "Unknown";

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
    // SEC containment (GAP-HR-SF-16 fold-in): this handler had literally no
    // requireRole call at all -- any authenticated caller in the tenant got
    // every employee whose birthday is today (name/department/designation)
    // plus the rest of the combined feed. Adds the same role set the
    // feature is meant for (HR, manager, employee).
    requireRole(ctx, ALL_ROLES);
    const limit = Math.min(Number((req.query as any)?.limit ?? 30), 50);
    const feed: any[] = [];

    const { kudos, birthdays, newJoinees, announcements, counts } = await withTenantGuc(ctx.tenantId, async (pool) => {
      // 1. Recent kudos (last 7 days)
      const kudos = await pool.query(
        `SELECT k.id, k.giver_name, k.receiver_name, k.badge, k.message, k.created_at,
                (SELECT COUNT(*) FROM employee.hrms_social_kudos_reactions r WHERE r.kudos_id = k.id) AS reactions
         FROM employee.hrms_social_kudos k WHERE k.tenant_id = $1 AND k.created_at > NOW() - INTERVAL '7 days'
         ORDER BY k.created_at DESC LIMIT 10`,
        [ctx.tenantId],
      );

      // 2. Today's birthdays.
      // Audit: first_name/last_name/department/designation/photo_url don't
      // exist on employee.hrms_employees (only full_name + department_id/
      // designation_id FKs; there is no per-employee photo column at all),
      // status='active' was never a legal value (see
      // migrations/0025_employee_status_contract.sql), and joining_date
      // isn't a column either -- the real one is date_of_joining. Any one of
      // these used to throw inside this handler's withTenantGuc call,
      // uncaught, 500ing the whole combined feed (kudos/announcements
      // included) -- fixed as part of the same pass that added the role gate.
      //
      // GAP-HR-SOCIAL-FEED-01 (remaining part, after the role-gate above):
      // "today" is now computed in Asia/Kolkata server-side (a server
      // running in a different zone/DST offset used to disagree with what
      // an IST viewer considers "today"), and the query now requires
      // e.share_birthday = true (added by migration 0159, default false) —
      // per the decision packet's recommended default ("add an opt-in flag,
      // default off; only show birthdays for employees who've actively
      // opted in"), an employee's birthday, department and designation are
      // no longer shown tenant-wide unless they've actively opted in. There
      // is not yet a self-service UI for setting that flag (a separate,
      // larger piece of work); until one ships this closes the exposure by
      // defaulting everyone out rather than leaving the feature half-built
      // and unsafe in the meantime.
      const birthdays = await pool.query(
        `SELECT e.id, e.full_name, d.name AS department, ds.name AS designation
         FROM employee.hrms_employees e
         LEFT JOIN employee.hrms_departments d ON d.id = e.department_id AND d.tenant_id = e.tenant_id
         LEFT JOIN employee.hrms_designations ds ON ds.id = e.designation_id AND ds.tenant_id = e.tenant_id
         WHERE e.tenant_id = $1 AND e.status = 'confirmed' AND e.share_birthday = true
           AND EXTRACT(MONTH FROM (NOW() AT TIME ZONE 'Asia/Kolkata')::date) = EXTRACT(MONTH FROM e.date_of_birth)
           AND EXTRACT(DAY FROM (NOW() AT TIME ZONE 'Asia/Kolkata')::date) = EXTRACT(DAY FROM e.date_of_birth)`,
        [ctx.tenantId],
      );

      // 3. New joinees (last 30 days)
      const newJoinees = await pool.query(
        `SELECT e.id, e.full_name, d.name AS department, ds.name AS designation, e.date_of_joining
         FROM employee.hrms_employees e
         LEFT JOIN employee.hrms_departments d ON d.id = e.department_id AND d.tenant_id = e.tenant_id
         LEFT JOIN employee.hrms_designations ds ON ds.id = e.designation_id AND ds.tenant_id = e.tenant_id
         WHERE e.tenant_id = $1 AND e.status = 'confirmed'
           AND e.date_of_joining > CURRENT_DATE - INTERVAL '30 days'
         ORDER BY e.date_of_joining DESC LIMIT 5`,
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

      // GAP-HR-SOCIAL-FEED-02: the stat cards used to just count the
      // already-truncated slice above (so e.g. "New Joinees" could never
      // read above 5, the LIMIT), implying a period total they weren't.
      // These are real COUNT(*) totals over the same window, independent of
      // the LIMITs the *displayed* feed still applies.
      const counts = await pool.query(
        `SELECT
           (SELECT COUNT(*) FROM employee.hrms_social_kudos WHERE tenant_id = $1 AND created_at > NOW() - INTERVAL '7 days') AS kudos7d,
           (SELECT COUNT(*) FROM employee.hrms_employees WHERE tenant_id = $1 AND status = 'confirmed' AND share_birthday = true
              AND EXTRACT(MONTH FROM (NOW() AT TIME ZONE 'Asia/Kolkata')::date) = EXTRACT(MONTH FROM date_of_birth)
              AND EXTRACT(DAY FROM (NOW() AT TIME ZONE 'Asia/Kolkata')::date) = EXTRACT(DAY FROM date_of_birth)) AS "birthdaysToday",
           (SELECT COUNT(*) FROM employee.hrms_employees WHERE tenant_id = $1 AND status = 'confirmed' AND date_of_joining > CURRENT_DATE - INTERVAL '30 days') AS "joinees30d",
           (SELECT COUNT(*) FROM employee.hrms_social_announcements WHERE tenant_id = $1 AND (expires_at IS NULL OR expires_at > NOW())) AS "announcementsActive"`,
        [ctx.tenantId],
      );

      return { kudos, birthdays, newJoinees, announcements, counts };
    });

    for (const k of kudos.rows) {
      feed.push({ type: "kudos", ...k, reactions: Number(k.reactions ?? 0), createdAt: k.created_at });
    }

    const today = new Date();
    for (const b of birthdays.rows) {
      feed.push({
        type: "birthday",
        id: b.id,
        name: b.full_name,
        department: b.department,
        designation: b.designation,
        createdAt: today.toISOString(),
      });
    }

    for (const j of newJoinees.rows) {
      feed.push({
        type: "new_joinee",
        id: j.id,
        name: j.full_name,
        department: j.department,
        designation: j.designation,
        joiningDate: j.date_of_joining,
        createdAt: j.date_of_joining,
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

    const c = counts.rows[0] ?? {};
    return reply.send({
      data: feed.slice(0, limit),
      counts: {
        kudos7d: Number(c.kudos7d ?? 0),
        birthdaysToday: Number(c.birthdaysToday ?? 0),
        joinees30d: Number(c.joinees30d ?? 0),
        announcementsActive: Number(c.announcementsActive ?? 0),
      },
    });
  });

  // ─── ANNOUNCEMENTS ──────────────────────────────────────────────────────

  /** POST /v1/hrms/announcements — create an org announcement (HR admin only) */
  app.post("/v1/hrms/announcements", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ["hr_admin", "super_admin"]);
    const body = announcementCreateSchema.parse(req.body);
    const id = randomUUID();
    const now = new Date().toISOString();

    // Author-name lookup is best-effort and deliberately kept OUTSIDE the
    // write below (its own withTenantGuc call) and fault-tolerant: it had a
    // not-found fallback to "Admin" already, and the column-name drift that
    // used to make this throw on every call (employee.hrms_employees has no
    // first_name/last_name/user_id -- see the social/feed handler above for
    // the full story) is now fixed. The try/catch stays as generic
    // resilience -- a failed name lookup for any other reason (a DB blip)
    // should still never block creating the announcement itself.
    let authorName = "Admin";
    try {
      authorName = await withTenantGuc(ctx.tenantId, async (pool) => {
        const authorRow = await pool.query(
          `SELECT full_name FROM employee.hrms_employees WHERE user_ref = $1 AND tenant_id = $2`,
          [ctx.actorId, ctx.tenantId],
        );
        return authorRow.rows[0]?.full_name ?? "Admin";
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
    // SEC containment: same missing-role-check gap as GET /social/feed
    // above (this route runs the identical birthdays query standalone) --
    // fixed alongside it since leaving this twin open would re-expose the
    // exact same data through an adjacent endpoint.
    requireRole(ctx, ALL_ROLES);
    const today = new Date();
    const mm = today.getMonth() + 1;
    const dd = today.getDate();

    const rows = await withTenantGuc(ctx.tenantId, (pool) => pool.query(
      `SELECT e.id, e.full_name, d.name AS department, ds.name AS designation
       FROM employee.hrms_employees e
       LEFT JOIN employee.hrms_departments d ON d.id = e.department_id AND d.tenant_id = e.tenant_id
       LEFT JOIN employee.hrms_designations ds ON ds.id = e.designation_id AND ds.tenant_id = e.tenant_id
       WHERE e.tenant_id = $1 AND e.status = 'confirmed'
         AND EXTRACT(MONTH FROM e.date_of_birth) = $2
         AND EXTRACT(DAY FROM e.date_of_birth) = $3`,
      [ctx.tenantId, mm, dd],
    ));

    return reply.send({
      data: rows.rows.map((r: any) => ({
        id: r.id,
        name: r.full_name,
        department: r.department,
        designation: r.designation,
      })),
    });
  });

  /**
   * POST /v1/hrms/birthdays/:id/wish — send birthday wish.
   * Audit: this handler took `id` straight from the URL and `message`
   * straight from the body with no Zod schema, no check that the target
   * employee exists, and no tenant scoping at all — unlike every other
   * write in this file. A caller could "wish" an arbitrary UUID, including
   * one belonging to a different tenant; recipient/recipientId on the
   * published event were never validated against anything. Fixed the same
   * way the kudos handler above already validates its own receiverId:
   * existence + tenant scope in one withTenantGuc-wrapped query (`WHERE
   * id = $1 AND tenant_id = $2`), which is also what makes a cross-tenant
   * id 404 instead of silently "succeeding". A self-wish guard mirrors this
   * file's existing SELF_APPROVAL pattern (travel-requests/expenses above).
   */
  app.post("/v1/hrms/birthdays/:id/wish", async (req, reply) => {
    const ctx = resolveContext(req);
    const { id } = req.params as { id: string };
    const body = birthdayWishSchema.parse(req.body ?? {});

    const { giverName } = await withTenantGuc(ctx.tenantId, async (pool) => {
      const targetRow = await pool.query(
        `SELECT id FROM employee.hrms_employees WHERE id = $1 AND tenant_id = $2`,
        [id, ctx.tenantId],
      );
      if (!targetRow.rows[0]) throw new HttpError(404, "RECEIVER_NOT_FOUND", "Employee not found");

      const giverRow = await pool.query(
        `SELECT id, full_name FROM employee.hrms_employees WHERE user_ref = $1 AND tenant_id = $2`,
        [ctx.actorId, ctx.tenantId],
      );
      const giver = giverRow.rows[0];
      if (giver?.id === id) {
        throw new HttpError(400, "SELF_WISH", "Cannot send a birthday wish to yourself");
      }

      return { giverName: giver?.full_name ?? undefined };
    });

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
        variables: { message: body.message ?? "Happy Birthday! 🎂", ...(giverName ? { giverName } : {}) },
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
    // call, not the same transaction) and fault-tolerant: the column-name
    // drift that used to make this always fail (no reporting_to or user_id
    // column -- the real ones are manager_id and user_ref) is now fixed. The
    // try/catch stays as generic resilience; the travel request itself must
    // still be created either way and only the notification may silently
    // no-op.
    let reportingTo: string | undefined;
    try {
      reportingTo = await withTenantGuc(ctx.tenantId, async (pool) => {
        const manager = await pool.query(
          `SELECT manager_id FROM employee.hrms_employees WHERE user_ref = $1 AND tenant_id = $2`,
          [ctx.actorId, ctx.tenantId],
        );
        return manager.rows[0]?.manager_id as string | undefined;
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

  /**
   * GET /v1/hrms/travel-requests — list my travel requests, or (?scope=team)
   * the pending/decided requests an approver (manager/HR) needs to act on.
   *
   * GAP-HR-TRAVEL-01: this was ALWAYS self-scoped (WHERE employee_id =
   * ctx.actorId, unconditionally) even though approve/reject existed for
   * manager/HR -- there was no way for an approver to ever see anyone
   * else's pending request to act on. `?scope=team` adds that queue: HR
   * gets the full tenant, a manager gets only their own direct reports'.
   *
   * NOTE on id spaces: employee_id on this table is ctx.actorId (the JWT
   * subject), NOT hrms_employees.id -- see this route's own POST handler,
   * which inserts ctx.actorId directly, and the existing reporting-manager
   * notification lookup just above, which already reads employee.
   * hrms_employees keyed by user_ref for exactly this reason. The two
   * lookups below (this file has no Drizzle schema of its own -- see this
   * module's header comment -- so this mirrors that same lookup's raw,
   * cross-schema `pool.query` shape rather than introducing a different
   * access pattern) resolve manager-scope and requester display names the
   * same way.
   */
  app.get("/v1/hrms/travel-requests", async (req, reply) => {
    const ctx = resolveContext(req);
    const q = z.object({ scope: z.enum(["me", "team"]).optional() }).parse(req.query);

    if (q.scope === "team") {
      const isHrActor = HR_ROLES.some((r) => ctx.roles.includes(r));
      if (!isHrActor && !ctx.roles.includes("manager")) {
        throw new HttpError(403, "FORBIDDEN", "team scope requires a manager or HR role");
      }

      let reportUserRefs: string[] | null = null; // null = HR, unrestricted (tenant-wide)
      if (!isHrActor) {
        reportUserRefs = await withTenantGuc(ctx.tenantId, async (pool) => {
          const mgr = await pool.query(
            `SELECT id FROM employee.hrms_employees WHERE user_ref = $1 AND tenant_id = $2`,
            [ctx.actorId, ctx.tenantId],
          );
          const managerEmpId = mgr.rows[0]?.id as string | undefined;
          if (!managerEmpId) return [];
          const reports = await pool.query(
            `SELECT user_ref FROM employee.hrms_employees WHERE manager_id = $1 AND tenant_id = $2 AND user_ref IS NOT NULL`,
            [managerEmpId, ctx.tenantId],
          );
          return reports.rows.map((r: { user_ref: string }) => r.user_ref);
        });
        if (reportUserRefs.length === 0) return reply.send({ data: [] });
      }

      const rows = await withTenantGuc(ctx.tenantId, (pool) => (reportUserRefs
        ? pool.query(
            `SELECT id, employee_id, purpose, destination, from_date, to_date, advance_required, mode, status, created_at, approved_by, approved_at, rejection_reason
             FROM claims.hrms_travel_requests
             WHERE tenant_id = $1 AND employee_id = ANY($2::uuid[])
             ORDER BY created_at DESC`,
            [ctx.tenantId, reportUserRefs],
          )
        : pool.query(
            `SELECT id, employee_id, purpose, destination, from_date, to_date, advance_required, mode, status, created_at, approved_by, approved_at, rejection_reason
             FROM claims.hrms_travel_requests
             WHERE tenant_id = $1
             ORDER BY created_at DESC`,
            [ctx.tenantId],
          )));
      const requesterIds = [...new Set(rows.rows.map((r: { employee_id: string }) => r.employee_id))];
      const nameByActorId = new Map<string, string>();
      if (requesterIds.length > 0) {
        const empRows = await withTenantGuc(ctx.tenantId, (pool) => pool.query(
          `SELECT user_ref, full_name FROM employee.hrms_employees WHERE tenant_id = $1 AND user_ref = ANY($2::text[])`,
          [ctx.tenantId, requesterIds],
        ));
        for (const r of empRows.rows as Array<{ user_ref: string; full_name: string }>) {
          nameByActorId.set(r.user_ref, r.full_name);
        }
      }
      return reply.send({ data: rows.rows.map((r: { employee_id: string }) => ({ ...r, employeeName: nameByActorId.get(r.employee_id) })) });
    }

    const rows = await withTenantGuc(ctx.tenantId, (pool) => pool.query(
      `SELECT id, purpose, destination, from_date, to_date, advance_required, mode, status, created_at, approved_by, approved_at, rejection_reason
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
      const requesterId = check.rows[0]?.employee_id as string | undefined;
      if (!requesterId) throw new HttpError(404, "NOT_FOUND", "Travel request not found or already processed");
      if (requesterId === ctx.actorId) {
        throw new HttpError(403, "SELF_APPROVAL", "Cannot approve your own travel request");
      }
      // GAP-HR-TRAVEL-01: previously any manager/HR could approve ANY
      // employee's travel request -- only self-approval was blocked. A
      // non-HR manager must now actually BE the requester's reporting
      // manager (employee.hrms_employees.manager_id), mirroring the
      // existing reporting-manager lookup this file already uses for the
      // create-notification (same raw cross-schema query shape, no JOIN
      // keyword, no TS import of the employee module's repo/schema).
      const isHrActor = HR_ROLES.some((r) => ctx.roles.includes(r));
      if (!isHrActor) {
        const link = await pool.query(
          `SELECT 1 FROM employee.hrms_employees requester
           WHERE requester.user_ref = $1 AND requester.tenant_id = $2
             AND requester.manager_id = (SELECT id FROM employee.hrms_employees WHERE user_ref = $3 AND tenant_id = $2)`,
          [requesterId, ctx.tenantId, ctx.actorId],
        );
        if ((link.rowCount ?? 0) === 0) {
          throw new HttpError(403, "FORBIDDEN", "you may only decide your own direct reports' travel requests");
        }
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
    const { reason } = z.object({ reason: z.string().max(500).optional() }).parse(req.body ?? {});
    const now = new Date().toISOString();

    await withTenantGuc(ctx.tenantId, async (pool) => {
      // GAP-HR-TRAVEL-01: this route had no self-decision guard at all
      // (approve did; reject didn't) and, like approve, let any manager/HR
      // decide any employee's request. Same two checks as approve above.
      const check = await pool.query(
        `SELECT employee_id FROM claims.hrms_travel_requests WHERE id = $1 AND tenant_id = $2`,
        [id, ctx.tenantId],
      );
      const requesterId = check.rows[0]?.employee_id as string | undefined;
      if (!requesterId) throw new HttpError(404, "NOT_FOUND", "Travel request not found or already processed");
      if (requesterId === ctx.actorId) {
        throw new HttpError(403, "SELF_APPROVAL", "Cannot reject your own travel request");
      }
      const isHrActor = HR_ROLES.some((r) => ctx.roles.includes(r));
      if (!isHrActor) {
        const link = await pool.query(
          `SELECT 1 FROM employee.hrms_employees requester
           WHERE requester.user_ref = $1 AND requester.tenant_id = $2
             AND requester.manager_id = (SELECT id FROM employee.hrms_employees WHERE user_ref = $3 AND tenant_id = $2)`,
          [requesterId, ctx.tenantId, ctx.actorId],
        );
        if ((link.rowCount ?? 0) === 0) {
          throw new HttpError(403, "FORBIDDEN", "you may only decide your own direct reports' travel requests");
        }
      }

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

  /**
   * GET /v1/hrms/expenses — list my expense claims, or (?scope=approvals)
   * other employees' pending claims for an approver to decide.
   *
   * GAP-HR-EXPENSES-02/03: previously this route ONLY ever filtered
   * employee_id = actorId with no role branch at all -- every role,
   * including hr_admin/manager, could only ever see their own claims, with
   * no way for an approver to even reach a pending claim from the API, let
   * alone the UI. ?scope=approvals below is additive: the default (no
   * scope, or any other value) behavior is completely unchanged.
   */
  app.get("/v1/hrms/expenses", async (req, reply) => {
    const ctx = resolveContext(req);
    const q = expenseListQuerySchema.parse(req.query);

    if (q.scope === "approvals") {
      requireRole(ctx, EXPENSE_DECIDE_ROLES);

      // GAP-HR-EXPENSES-SOD-01: scope to the manager's own direct reports,
      // mirroring claims.hrms_travel_requests' own ?scope=team branch above
      // (same raw cross-schema lookup, same null-means-unrestricted shape).
      // hr_admin/finance_officer/super_admin (EXPENSE_BYPASS_ROLES) stay
      // tenant-wide, same as isHrActor does for travel-requests.
      const isPrivilegedDecider = EXPENSE_BYPASS_ROLES.some((r) => ctx.roles.includes(r));
      let reportUserRefs: string[] | null = null; // null = unrestricted
      if (!isPrivilegedDecider) {
        reportUserRefs = await withTenantGuc(ctx.tenantId, async (pool) => {
          const mgr = await pool.query(
            `SELECT id FROM employee.hrms_employees WHERE user_ref = $1 AND tenant_id = $2`,
            [ctx.actorId, ctx.tenantId],
          );
          const managerEmpId = mgr.rows[0]?.id as string | undefined;
          if (!managerEmpId) return [];
          const reports = await pool.query(
            `SELECT user_ref FROM employee.hrms_employees WHERE manager_id = $1 AND tenant_id = $2 AND user_ref IS NOT NULL`,
            [managerEmpId, ctx.tenantId],
          );
          return reports.rows.map((r: { user_ref: string }) => r.user_ref);
        });
        if (reportUserRefs.length === 0) return reply.send({ data: [] });
      }

      const rows = await withTenantGuc(ctx.tenantId, (pool) => (reportUserRefs
        ? pool.query(
            `SELECT id, employee_id, category, amount, description, expense_date AS date, receipt_key AS "receiptKey", status, created_at
             FROM claims.hrms_expense_claims
             WHERE tenant_id = $1 AND status = 'pending' AND employee_id = ANY($2::uuid[])
             ORDER BY created_at ASC`,
            [ctx.tenantId, reportUserRefs],
          )
        : pool.query(
            `SELECT id, employee_id, category, amount, description, expense_date AS date, receipt_key AS "receiptKey", status, created_at
             FROM claims.hrms_expense_claims
             WHERE tenant_id = $1 AND status = 'pending' AND employee_id != $2
             ORDER BY created_at ASC`,
            [ctx.tenantId, ctx.actorId],
          )));
      // Resolve requester display names the same way claims.hrms_travel_requests'
      // own ?scope=team branch above does (this file has no Drizzle schema
      // of its own -- see this module's header comment -- so this mirrors
      // that same lookup's raw, cross-schema `pool.query` shape).
      const employeeIds = [...new Set(rows.rows.map((r: { employee_id: string }) => r.employee_id))];
      const nameByActorId = new Map<string, string>();
      if (employeeIds.length > 0) {
        const empRows = await withTenantGuc(ctx.tenantId, (pool) => pool.query(
          `SELECT user_ref, full_name FROM employee.hrms_employees WHERE tenant_id = $1 AND user_ref = ANY($2::text[])`,
          [ctx.tenantId, employeeIds],
        ));
        for (const r of empRows.rows as Array<{ user_ref: string; full_name: string }>) {
          nameByActorId.set(r.user_ref, r.full_name);
        }
      }
      return reply.send({
        data: rows.rows.map((r: { employee_id: string }) => ({ ...r, employeeName: nameByActorId.get(r.employee_id) })),
      });
    }

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
    requireRole(ctx, EXPENSE_DECIDE_ROLES);
    const { id } = req.params as { id: string };
    const now = new Date().toISOString();

    await withTenantGuc(ctx.tenantId, async (pool) => {
      // SoD: verify approver is not the submitter
      const check = await pool.query(
        `SELECT employee_id FROM claims.hrms_expense_claims WHERE id = $1 AND tenant_id = $2`,
        [id, ctx.tenantId],
      );
      const requesterId = check.rows[0]?.employee_id as string | undefined;
      if (requesterId === ctx.actorId) {
        throw new HttpError(403, "SELF_APPROVAL", "Cannot approve your own expense claim");
      }

      // GAP-HR-EXPENSES-SOD-01: reporting-line check, mirrors
      // claims.hrms_travel_requests' own approve (GAP-HR-TRAVEL-01) just
      // above in this file. Skipped when the claim doesn't exist (requesterId
      // undefined) -- the UPDATE's own rowCount check below already 404s that
      // case, same as before this fix.
      if (requesterId) {
        const isPrivilegedDecider = EXPENSE_BYPASS_ROLES.some((r) => ctx.roles.includes(r));
        if (!isPrivilegedDecider) {
          const link = await pool.query(
            `SELECT 1 FROM employee.hrms_employees requester
             WHERE requester.user_ref = $1 AND requester.tenant_id = $2
               AND requester.manager_id = (SELECT id FROM employee.hrms_employees WHERE user_ref = $3 AND tenant_id = $2)`,
            [requesterId, ctx.tenantId, ctx.actorId],
          );
          if ((link.rowCount ?? 0) === 0) {
            throw new HttpError(403, "FORBIDDEN", "you may only decide your own direct reports' expense claims");
          }
        }
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

  /**
   * PATCH /v1/hrms/expenses/:id/reject — reject expense claim.
   *
   * GAP-HR-EXPENSES-02: no reject endpoint existed at all for an expense
   * claim (unlike travel-requests, which has had one since this same
   * module's original cut) -- the "Rejected" stat tile on the web page could
   * therefore never be non-zero. A reason is mandatory here (unlike
   * travel-requests' optional one): this is money leaving "Pending" with no
   * further workflow step, so the reason is the only record of why.
   */
  app.patch("/v1/hrms/expenses/:id/reject", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, EXPENSE_DECIDE_ROLES);
    const { id } = req.params as { id: string };
    const body = expenseRejectSchema.parse(req.body);
    const now = new Date().toISOString();

    await withTenantGuc(ctx.tenantId, async (pool) => {
      // SoD: verify approver is not the submitter — same check, and the same
      // SELF_APPROVAL code, as approve above (travel-requests' own reject
      // handler reuses its approve's code the same way).
      const check = await pool.query(
        `SELECT employee_id FROM claims.hrms_expense_claims WHERE id = $1 AND tenant_id = $2`,
        [id, ctx.tenantId],
      );
      const requesterId = check.rows[0]?.employee_id as string | undefined;
      if (requesterId === ctx.actorId) {
        throw new HttpError(403, "SELF_APPROVAL", "Cannot reject your own expense claim");
      }

      // GAP-HR-EXPENSES-SOD-01: reporting-line check, same as approve above.
      if (requesterId) {
        const isPrivilegedDecider = EXPENSE_BYPASS_ROLES.some((r) => ctx.roles.includes(r));
        if (!isPrivilegedDecider) {
          const link = await pool.query(
            `SELECT 1 FROM employee.hrms_employees requester
             WHERE requester.user_ref = $1 AND requester.tenant_id = $2
               AND requester.manager_id = (SELECT id FROM employee.hrms_employees WHERE user_ref = $3 AND tenant_id = $2)`,
            [requesterId, ctx.tenantId, ctx.actorId],
          );
          if ((link.rowCount ?? 0) === 0) {
            throw new HttpError(403, "FORBIDDEN", "you may only decide your own direct reports' expense claims");
          }
        }
      }

      const result = await pool.query(
        `UPDATE claims.hrms_expense_claims SET status = 'rejected', rejection_reason = $1, approved_by = $2, approved_at = $3, updated_at = $3
         WHERE id = $4 AND tenant_id = $5 AND status = 'pending' RETURNING id`,
        [body.reason, ctx.actorId, now, id, ctx.tenantId],
      );
      if (result.rowCount === 0) throw new HttpError(404, "NOT_FOUND", "Expense claim not found or already processed");
    });

    return reply.send({ id, status: "rejected" });
  });

  /**
   * GET /v1/hrms/expenses/:id/receipt — short-lived presigned download URL
   * for a claim's receipt.
   *
   * GAP-HR-EXPENSES-04: receiptKey was already returned by the list route
   * but never shown anywhere, and no route existed to turn it into something
   * downloadable (it's an object-storage key, not a URL). Receipts may carry
   * PII, so this returns a short-lived SigV4 link (@civitasone/storage,
   * same presign helper used by services/hrms-service/src/modules/employee/
   * commands.ts for the employee-document upload side of this same pattern)
   * rather than ever exposing a permanent/public one, and is restricted to
   * the claim's own owner or an approver role.
   */
  app.get("/v1/hrms/expenses/:id/receipt", async (req, reply) => {
    const ctx = resolveContext(req);
    const { id } = req.params as { id: string };

    const claim = await withTenantGuc(ctx.tenantId, (pool) => pool.query(
      `SELECT employee_id, receipt_key FROM claims.hrms_expense_claims WHERE id = $1 AND tenant_id = $2`,
      [id, ctx.tenantId],
    ));
    const row = claim.rows[0] as { employee_id: string; receipt_key: string | null } | undefined;
    if (!row) throw new HttpError(404, "NOT_FOUND", "Expense claim not found");

    const isOwner = row.employee_id === ctx.actorId;
    const isDecideRole = EXPENSE_DECIDE_ROLES.some((r) => ctx.roles.includes(r));
    let isAuthorizedApprover = false;
    if (isDecideRole) {
      // GAP-HR-EXPENSES-SOD-01: a non-privileged "manager" may only view a
      // receipt for a claim belonging to their own direct report -- same
      // reporting-line scope as approve/reject/?scope=approvals above, not
      // "any EXPENSE_DECIDE_ROLES member may view any claim's receipt".
      const isPrivilegedDecider = EXPENSE_BYPASS_ROLES.some((r) => ctx.roles.includes(r));
      if (isPrivilegedDecider) {
        isAuthorizedApprover = true;
      } else {
        isAuthorizedApprover = await withTenantGuc(ctx.tenantId, async (pool) => {
          const link = await pool.query(
            `SELECT 1 FROM employee.hrms_employees requester
             WHERE requester.user_ref = $1 AND requester.tenant_id = $2
               AND requester.manager_id = (SELECT id FROM employee.hrms_employees WHERE user_ref = $3 AND tenant_id = $2)`,
            [row.employee_id, ctx.tenantId, ctx.actorId],
          );
          return (link.rowCount ?? 0) > 0;
        });
      }
    }
    if (!isOwner && !isAuthorizedApprover) {
      throw new HttpError(403, "FORBIDDEN", "You may only view a receipt you own or are authorized to approve");
    }
    if (!row.receipt_key) throw new HttpError(404, "NO_RECEIPT", "This claim has no receipt on file");

    const url = await presignedGetUrl({ key: row.receipt_key, expiresIn: 300 });

    // GAP-HR-EXPENSES-04 (DPDP): data-access audit event on every fetch of a
    // possibly-PII-bearing receipt link. This is a GET, so the fleet-wide
    // audit `onResponse` hook (app.ts) never fires for it (it explicitly
    // skips GET/HEAD/OPTIONS) -- logged explicitly here instead, the same
    // way apar/routes.ts's own appraisal-detail GET does for the same reason.
    // writeAuditLog is fire-and-forget and never throws (shared/audit.ts): a
    // logging failure must never turn a successful read into a 500.
    await writeAuditLog({
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      actorType: null,
      actorRoles: ctx.roles,
      method: req.method,
      path: req.url,
      statusCode: 200,
      requestId: (req.headers["x-correlation-id"] as string) ?? req.id,
      ipAddr: req.ip,
    });

    return reply.send({ url, expiresIn: 300 });
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

    // Audit: same column-name drift as the rest of this file (full_name not
    // first_name/last_name, status='confirmed' not 'active', department/
    // designation via their lookup tables, manager_id not reporting_to,
    // employee_no not employee_code, no per-employee photo column) --
    // ORDER BY now sorts by the resolved designation name, matching intent
    // (the raw designation_id ordering this had before was meaningless to a
    // viewer anyway).
    const rows = await withTenantGuc(ctx.tenantId, (pool) => pool.query(
      `SELECT e.id, e.full_name, ds.name AS designation, d.name AS department, e.manager_id, e.employee_no
       FROM employee.hrms_employees e
       LEFT JOIN employee.hrms_departments d ON d.id = e.department_id AND d.tenant_id = e.tenant_id
       LEFT JOIN employee.hrms_designations ds ON ds.id = e.designation_id AND ds.tenant_id = e.tenant_id
       WHERE e.tenant_id = $1 AND e.status = 'confirmed'
       ORDER BY ds.name`,
      [ctx.tenantId],
    ));

    // Build tree
    const employees = rows.rows.map((r: any) => ({
      id: r.id,
      name: r.full_name,
      designation: r.designation,
      department: r.department,
      reportingTo: r.manager_id,
      employeeCode: r.employee_no,
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
