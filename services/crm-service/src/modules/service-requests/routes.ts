import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { scopedRead } from "../../shared/db.js";
import { listQuery, windowOf, listEnvelope } from "../../shared/list-query.js";
import { maskList, maskRecord } from "../../shared/pii-reveal.js";
import { recordStatusHistory, listStatusHistory } from "../../shared/case-status-history.js";
import { enqueue } from "../../shared/outbox.js";
import { emitWithAudit } from "../../shared/route-audit.js";
import { isActiveTenantUser } from "../../shared/identity-client.js";
import { resolveUserNames } from "../../shared/user-directory.js";
import { COMMANDS, EVENTS } from "../../topics.js";

const CRM_ROLES = ["crm_user", "crm_admin", "super_admin", "tenant_admin"];
const ADMIN_ROLES = ["crm_admin", "super_admin", "tenant_admin"];

const PRIORITY = ["low", "normal", "high", "urgent"] as const;
const STATUS = ["open", "in_progress", "pending", "resolved", "closed", "cancelled"] as const;
const INTAKE_CHANNEL = ["walk_in", "phone", "portal", "email", "letter"] as const;

const createBody = z.object({
  contactId: z.string().uuid().optional(),
  citizenName: z.string().min(1).max(200),
  citizenPhone: z.string().min(3).max(32).optional(),
  citizenEmail: z.string().email().max(320).optional(),
  serviceType: z.string().min(1).max(64),
  subject: z.string().min(1).max(500),
  description: z.string().max(5000).optional(),
  priority: z.enum(PRIORITY).default("normal"),
  dueAt: z.string().datetime().optional(),
  // GAP-CRM-SERVICE-REQUESTS-NEW-03: capture how the request was received so it
  // can be reported on by channel. Optional; constrained to a known set.
  intakeChannel: z.enum(INTAKE_CHANNEL).optional(),
});

const listParams = listQuery.extend({
  status: z.enum(STATUS).optional(),
  priority: z.enum(PRIORITY).optional(),
  serviceType: z.string().max(64).optional(),
  assignedTo: z.string().uuid().optional(),
  search: z.string().max(200).optional(),
});

const updateStatusBody = z.object({
  status: z.enum(STATUS),
  // `resolution` means strictly "how the request was fulfilled" and is only
  // meaningful on resolve. `statusNote` carries the non-resolution reason for
  // other transitions (what a pending request is waiting on; closing remarks).
  // Keeping them distinct stops a Close from overwriting a genuine resolution
  // and stops a pending request from showing a bogus "Resolution" card
  // (GAP-CRM-SERVICE-REQUESTS-DETAIL-01).
  resolution: z.string().max(5000).optional(),
  statusNote: z.string().max(5000).optional(),
  assignedTo: z.string().uuid().optional(),
  // GAP-CRM-SERVICE-REQUESTS-DETAIL-03: optimistic concurrency. When the client
  // sends the `version` it read, a stale write (someone else already advanced
  // the request) is rejected with 409 instead of silently overwriting. Optional
  // for backward compatibility with callers that have not adopted it yet.
  version: z.number().int().nonnegative().optional(),
});

const idParam = z.object({ id: z.string().uuid() });

// GAP-CRM-SERVICE-REQUESTS-DETAIL-05: assign / reassign an officer. Its own
// route (rather than a side field on the status PATCH) so an assignment is a
// deliberate, separately audited and separately authorised act.
const assignBody = z.object({
  assignedTo: z.string().uuid(),
  // Optimistic concurrency, exactly as on the status PATCH.
  version: z.number().int().nonnegative().optional(),
});

// GAP-CRM-SERVICE-REQUESTS-NEW-04: "has this citizen already got an open
// request?" Sent as a POST BODY (not a query string) because it carries a phone
// number / email: request URLs are logged, bodies are not.
const duplicateCheckBody = z
  .object({
    phone: z.string().min(3).max(32).optional(),
    email: z.string().email().max(320).optional(),
    serviceType: z.string().min(1).max(64).optional(),
  })
  .refine((b) => b.phone !== undefined || b.email !== undefined, {
    message: "phone or email is required",
  });

/** Requests still being worked: the only ones a new request can duplicate. */
const OPEN_STATUSES = ["open", "in_progress", "pending"] as const;

function srRef(): string {
  const yr = new Date().getFullYear();
  const suffix = Date.now().toString(36).toUpperCase().slice(-6);
  return `SRQ/${yr}/${suffix}`;
}

export async function serviceRequestRoutes(app: FastifyInstance): Promise<void> {
  // POST /v1/crm/service-requests
  app.post("/v1/crm/service-requests", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const body = createBody.parse(req.body);
    const refNo = srRef();

    const row = await scopedRead(async (tx) => {
      // F6-03: when the caller gives no explicit dueAt, derive it from the
      // picked service type's SLA. due_at = created_at + sla_hours. Match on the
      // active service_types master by code OR label (the form sends the label),
      // taking the lowest sla_hours if both somehow match. NULL when the type has
      // no SLA / is not in the master -> due_at stays NULL (today's behaviour).
      let slaDueExpr = sql`${body.dueAt ?? null}`;
      // GAP-CRM-SERVICE-REQUESTS-NEW-03: say where the due date came from so the
      // caller never has to guess whether a missing one is a bug or "no SLA".
      let dueSource: "explicit" | "sla" | "none" = body.dueAt !== undefined ? "explicit" : "none";
      if (body.dueAt === undefined) {
        const slaRows = (await tx.execute(sql`
          SELECT sla_hours AS "slaHours"
          FROM crm.service_types
          WHERE tenant_id = ${ctx.tenantId}
            AND active = true
            AND sla_hours IS NOT NULL
            AND (code = ${body.serviceType} OR label = ${body.serviceType})
          ORDER BY sla_hours ASC
          LIMIT 1
        `)) as unknown as Array<{ slaHours: number }>;
        const slaHours = slaRows[0]?.slaHours;
        if (slaHours !== undefined && slaHours !== null) {
          slaDueExpr = sql`now() + make_interval(hours => ${slaHours})`;
          dueSource = "sla";
        }
      }

      const inserted = (await tx.execute(sql`
        INSERT INTO crm.service_requests (
          tenant_id, contact_id, citizen_name, citizen_phone, citizen_email,
          service_type, subject, description, priority, status,
          due_at, intake_channel, reference_no, created_by, updated_by
        ) VALUES (
          ${ctx.tenantId}, ${body.contactId ?? null}, ${body.citizenName},
          ${body.citizenPhone ?? null}, ${body.citizenEmail ?? null},
          ${body.serviceType}, ${body.subject}, ${body.description ?? null},
          ${body.priority}, 'open',
          ${slaDueExpr}, ${body.intakeChannel ?? null}, ${refNo}, ${ctx.actorId}, ${ctx.actorId}
        )
        RETURNING id, reference_no AS "referenceNo",
                  citizen_name AS "citizenName", service_type AS "serviceType",
                  subject, priority, status, intake_channel AS "intakeChannel",
                  due_at AS "dueAt", created_at AS "createdAt"
      `)) as unknown as Array<Record<string, unknown>>;

      // F6-01: seed the timeline with the opening transition (null -> open),
      // in the same tx as the insert.
      await recordStatusHistory(tx, {
        tenantId: ctx.tenantId,
        resourceType: "service_request",
        resourceId: String(inserted[0]?.id),
        fromStatus: null,
        toStatus: "open",
        note: null,
        actorId: ctx.actorId,
      });
      // GAP2-CRM-SERVICE-REQUESTS-AUDIT-02: emit the platform audit event in the
      // SAME tx as the write. case_status_history is an in-service timeline, not
      // the cross-service audit.event.record the audit-service consumes. Payload
      // carries NO citizen PII.
      await emitWithAudit(tx, ctx, {
        eventType: EVENTS.serviceRequestCreated,
        action: "create",
        resourceType: "service_request",
        resourceId: String(inserted[0]?.id),
        payload: { serviceRequestId: String(inserted[0]?.id), status: "open", serviceType: body.serviceType },
      });
      return { ...inserted[0], dueSource };
    });
    return reply.code(201).send({ data: row });
  });

  // POST /v1/crm/service-requests/duplicate-check — GAP-CRM-SERVICE-REQUESTS-NEW-04.
  // Open requests already on file for this phone / email, so the intake clerk is
  // warned before logging the same citizen's request twice. It WARNS, it never
  // blocks: the response carries ids and references only (no citizen contact
  // data), and the form decides what to do with it.
  app.post(
    "/v1/crm/service-requests/duplicate-check",
    { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const ctx = resolveContext(req);
      requireRole(ctx, CRM_ROLES);
      const body = duplicateCheckBody.parse(req.body);

      // Match on the last 10 digits so "+91 98123 45678", "09812345678" and
      // "9812345678" are the same citizen. Fewer than 10 digits cannot identify
      // anyone, so it is simply not searched on.
      const phone10 = body.phone ? body.phone.replace(/\D/g, "").slice(-10) : "";
      const phoneOk = phone10.length === 10;
      const email = body.email ? body.email.trim().toLowerCase() : "";
      if (!phoneOk && !email) return reply.send({ data: [], meta: { total: 0 } });

      const matchPhone = phoneOk
        ? sql`right(regexp_replace(coalesce(r.citizen_phone, ''), '[^0-9]', '', 'g'), 10) = ${phone10}`
        : null;
      const matchEmail = email ? sql`lower(r.citizen_email) = ${email}` : null;
      const matches = [matchPhone, matchEmail].filter((m): m is NonNullable<typeof m> => m !== null);

      const rows = (await scopedRead((tx) => tx.execute(sql`
        SELECT r.id, r.reference_no AS "referenceNo", r.service_type AS "serviceType",
               r.status, r.subject, r.created_at AS "createdAt"
        FROM crm.service_requests r
        WHERE r.tenant_id = ${ctx.tenantId}
          AND r.status IN (${sql.join(OPEN_STATUSES.map((s) => sql`${s}`), sql`, `)})
          AND (${sql.join(matches, sql` OR `)})
        ORDER BY r.created_at DESC
        LIMIT 5
      `))) as unknown as Array<Record<string, unknown>>;

      const data = rows.map((r) => ({
        ...r,
        sameServiceType: body.serviceType !== undefined && r["serviceType"] === body.serviceType,
      }));
      return reply.send({ data, meta: { total: data.length } });
    },
  );

  // GET /v1/crm/service-requests/:id/history — F6-01 status timeline
  app.get("/v1/crm/service-requests/:id/history", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const { id } = idParam.parse(req.params);

    // 404 when the request does not exist for this tenant (not an empty list).
    const [exists] = (await scopedRead((tx) => tx.execute(sql`
      SELECT 1 AS ok FROM crm.service_requests
      WHERE id = ${id} AND tenant_id = ${ctx.tenantId}
    `))) as unknown as Array<{ ok: number }>;
    if (!exists) throw new HttpError(404, "NOT_FOUND", "service request not found");

    const data = await listStatusHistory(ctx.tenantId, "service_request", id);
    return reply.send({ data, meta: { total: data.length } });
  });

  // GET /v1/crm/service-requests
  app.get("/v1/crm/service-requests", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const q = listParams.parse(req.query ?? {});
    const w = windowOf(q);

    const statusF     = q.status      ? sql`AND r.status       = ${q.status}`             : sql``;
    const priorityF   = q.priority    ? sql`AND r.priority      = ${q.priority}`           : sql``;
    const typeF       = q.serviceType ? sql`AND r.service_type  = ${q.serviceType}`        : sql``;
    const assignedF   = q.assignedTo  ? sql`AND r.assigned_to   = ${q.assignedTo}::uuid`  : sql``;
    const searchF = q.search
      ? sql`AND (r.citizen_name ILIKE ${"%" + q.search + "%"}
                 OR r.subject    ILIKE ${"%" + q.search + "%"}
                 OR r.reference_no ILIKE ${"%" + q.search + "%"})`
      : sql``;

    const rows = (await scopedRead((tx) => tx.execute(sql`
      SELECT r.id, r.reference_no AS "referenceNo", r.citizen_name AS "citizenName",
             r.citizen_phone AS "citizenPhone", r.service_type AS "serviceType",
             r.subject, r.priority, r.status,
             r.assigned_to AS "assignedTo", r.contact_id AS "contactId",
             r.due_at AS "dueAt", r.resolved_at AS "resolvedAt",
             r.created_at AS "createdAt", r.updated_at AS "updatedAt", r.version
      FROM crm.service_requests r
      WHERE r.tenant_id = ${ctx.tenantId}
        ${statusF} ${priorityF} ${typeF} ${assignedF} ${searchF}
      ORDER BY
        CASE r.priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'normal' THEN 3 ELSE 4 END,
        r.created_at DESC
      LIMIT ${w.pageSize} OFFSET ${w.offset}
    `))) as unknown as Array<Record<string, unknown>>;

    const [ct] = (await scopedRead((tx) => tx.execute(sql`
      SELECT COUNT(*)::int AS total FROM crm.service_requests r
      WHERE r.tenant_id = ${ctx.tenantId}
        ${statusF} ${priorityF} ${typeF} ${assignedF} ${searchF}
    `))) as unknown as Array<{ total: number }>;

    // GAP-CRM-SERVICE-REQUESTS-05: per-status totals for the whole filtered
    // register (honouring every filter EXCEPT status, so the summary tiles stay
    // meaningful while a status filter is applied and always sum to the register
    // total). Computed server-side so the tiles never reflect only one page.
    const statusRows = (await scopedRead((tx) => tx.execute(sql`
      SELECT r.status AS status, COUNT(*)::int AS count
      FROM crm.service_requests r
      WHERE r.tenant_id = ${ctx.tenantId}
        ${priorityF} ${typeF} ${assignedF} ${searchF}
      GROUP BY r.status
    `))) as unknown as Array<{ status: string; count: number }>;

    const statusCounts: Record<string, number> = {};
    for (const s of STATUS) statusCounts[s] = 0;
    for (const row of statusRows) statusCounts[row.status] = row.count;

    const envelope = listEnvelope(maskList("service_request", rows, ctx.roles), w, ct?.total ?? 0);
    return reply.send({ ...envelope, meta: { ...envelope.meta, statusCounts } });
  });

  // GET /v1/crm/service-requests/:id
  app.get("/v1/crm/service-requests/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const { id } = idParam.parse(req.params);

    const rows = (await scopedRead((tx) => tx.execute(sql`
      SELECT r.id, r.reference_no AS "referenceNo", r.citizen_name AS "citizenName",
             r.citizen_phone AS "citizenPhone", r.citizen_email AS "citizenEmail",
             r.service_type AS "serviceType", r.subject, r.description,
             r.priority, r.status, r.assigned_to AS "assignedTo",
             r.contact_id AS "contactId", c.name AS "contactName",
             r.resolution, r.status_note AS "statusNote",
             r.intake_channel AS "intakeChannel",
             r.due_at AS "dueAt", r.resolved_at AS "resolvedAt",
             r.closed_at AS "closedAt",
             r.created_at AS "createdAt", r.updated_at AS "updatedAt",
             r.created_by AS "createdBy", r.updated_by AS "updatedBy", r.version,
             r.citizen_notify_channel AS "notifyChannel",
             r.citizen_notify_outcome AS "notifyOutcome",
             r.citizen_notified_at AS "notifiedAt"
      FROM crm.service_requests r
      LEFT JOIN crm.contacts c ON c.id = r.contact_id AND c.tenant_id = r.tenant_id AND c.status <> 'deleted'
      WHERE r.id = ${id} AND r.tenant_id = ${ctx.tenantId}
    `))) as unknown as Array<Record<string, unknown>>;

    if (rows.length === 0) throw new HttpError(404, "NOT_FOUND", "service request not found");
    const row = rows[0]!;

    // GAP-CRM-SERVICE-REQUESTS-DETAIL-03 / -05: officer ids -> display names, so
    // the page can say who logged, last changed and owns the request. Fail-open:
    // an unresolved name is null (the UI says "name unavailable"), never an id.
    const names = await resolveUserNames(ctx.tenantId, [
      row["createdBy"] as string | null,
      row["updatedBy"] as string | null,
      row["assignedTo"] as string | null,
    ]);
    const nameOf = (v: unknown): string | null => (typeof v === "string" ? names.get(v) ?? null : null);

    // GAP-CRM-SERVICE-REQUESTS-DETAIL-04: fold the three delivery columns into one
    // object; null when no notification was ever attempted for this request.
    const { notifyChannel, notifyOutcome, notifiedAt, ...rest } = row;
    const citizenNotification =
      notifyChannel || notifyOutcome
        ? { channel: notifyChannel ?? null, outcome: notifyOutcome ?? null, at: notifiedAt ?? null }
        : null;

    return reply.send({
      data: {
        ...maskRecord("service_request", rest, ctx.roles),
        createdByName: nameOf(row["createdBy"]),
        updatedByName: nameOf(row["updatedBy"]),
        assignedToName: nameOf(row["assignedTo"]),
        citizenNotification,
      },
    });
  });

  // PATCH /v1/crm/service-requests/:id/status — update status / close
  app.patch("/v1/crm/service-requests/:id/status", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const { id } = idParam.parse(req.params);
    const body = updateStatusBody.parse(req.body);

    if (body.status === "closed" || body.status === "cancelled") {
      requireRole(ctx, ADMIN_ROLES);
    }

    const versionF =
      body.version !== undefined ? sql`AND version = ${body.version}` : sql``;

    // F6-01: capture the pre-transition status (via a CTE over the row as it was
    // before the UPDATE) and write the history row in the SAME tx as the write,
    // so a transition and its timeline entry commit or roll back together.
    const rows = (await scopedRead(async (tx) => {
      const updated = (await tx.execute(sql`
        WITH prev AS (
          SELECT status FROM crm.service_requests
          WHERE id = ${id} AND tenant_id = ${ctx.tenantId}
        )
        UPDATE crm.service_requests
        SET status = ${body.status},
            resolution = COALESCE(${body.resolution ?? null}, resolution),
            status_note = COALESCE(${body.statusNote ?? null}, status_note),
            assigned_to = COALESCE(${body.assignedTo ?? null}::uuid, assigned_to),
            -- GAP-CRM-SERVICE-REQUESTS-DETAIL-04: resolving/closing starts a fresh
            -- citizen notification. Record the channel it will use now (email first,
            -- else SMS - the same rule the notify consumer applies), or that there is
            -- NO contact on file so the caller and the page can say so at once. The
            -- consumer overwrites the outcome when delivery reaches a result.
            citizen_notify_channel = CASE WHEN ${body.status} IN ('resolved', 'closed')
              THEN CASE WHEN coalesce(citizen_email, '') <> '' THEN 'email'
                        WHEN coalesce(citizen_phone, '') <> '' THEN 'sms' END
              ELSE citizen_notify_channel END,
            citizen_notify_outcome = CASE WHEN ${body.status} IN ('resolved', 'closed')
              THEN CASE WHEN coalesce(citizen_email, '') = '' AND coalesce(citizen_phone, '') = ''
                        THEN 'no_contact' END
              ELSE citizen_notify_outcome END,
            citizen_notified_at = CASE WHEN ${body.status} IN ('resolved', 'closed')
              THEN CASE WHEN coalesce(citizen_email, '') = '' AND coalesce(citizen_phone, '') = ''
                        THEN now() END
              ELSE citizen_notified_at END,
            resolved_at = CASE WHEN ${body.status} = 'resolved' AND resolved_at IS NULL THEN now() ELSE resolved_at END,
            closed_at   = CASE WHEN ${body.status} IN ('closed', 'cancelled') AND closed_at IS NULL THEN now() ELSE closed_at END,
            updated_by = ${ctx.actorId}, updated_at = now(), version = version + 1
        WHERE id = ${id} AND tenant_id = ${ctx.tenantId}
          AND status NOT IN ('closed', 'cancelled')
          ${versionF}
        RETURNING id, status, (SELECT status FROM prev) AS "fromStatus",
                  assigned_to AS "assignedTo", resolved_at AS "resolvedAt",
                  closed_at AS "closedAt", resolution, status_note AS "statusNote", version,
                  citizen_notify_channel AS "notifyChannel",
                  citizen_notify_outcome AS "notifyOutcome"
      `)) as unknown as Array<Record<string, unknown>>;

      if (updated.length > 0) {
        await recordStatusHistory(tx, {
          tenantId: ctx.tenantId,
          resourceType: "service_request",
          resourceId: id,
          fromStatus: (updated[0]?.["fromStatus"] as string | null) ?? null,
          toStatus: body.status,
          note: body.resolution ?? body.statusNote ?? null,
          actorId: ctx.actorId,
        });

        // GAP2-CRM-SERVICE-REQUESTS-AUDIT-02: emit the platform audit event in
        // the SAME tx as the status change. Payload carries NO PII.
        await emitWithAudit(tx, ctx, {
          eventType: EVENTS.serviceRequestStatusChanged,
          action: "status_changed",
          resourceType: "service_request",
          resourceId: id,
          payload: {
            serviceRequestId: id,
            fromStatus: (updated[0]?.["fromStatus"] as string | null) ?? null,
            toStatus: body.status,
          },
        });

        // F6-02: on resolve/close, enqueue a transactional citizen notification
        // through the queue (never an inline HTTP call in the request). The
        // command carries NO PII — the consumer reads the SR row for the citizen
        // phone/email at send time, so the contact value never enters the queue
        // envelope or any consumer log. The consumer no-ops when there is no
        // phone/email on the request.
        if (body.status === "resolved" || body.status === "closed") {
          await enqueue(tx as Parameters<typeof enqueue>[0], {
            topic: COMMANDS.notifyServiceRequestResolution,
            eventType: COMMANDS.notifyServiceRequestResolution,
            tenantId: ctx.tenantId,
            actorId: ctx.actorId,
            correlationId: ctx.correlationId,
            payload: {
              serviceRequestId: id,
              tenantId: ctx.tenantId,
              status: body.status,
            },
          });
        }
      }
      return updated;
    })) as unknown as Array<Record<string, unknown>>;

    if (rows.length === 0) {
      // Disambiguate: a row that still exists in a non-terminal state means the
      // caller's `version` was stale (someone else changed it first) — a 409 so
      // the UI can prompt a reload rather than silently losing the write
      // (GAP-CRM-SERVICE-REQUESTS-DETAIL-03). A genuinely missing/already-closed
      // request stays a 404.
      const [current] = (await scopedRead((tx) => tx.execute(sql`
        SELECT version, status FROM crm.service_requests
        WHERE id = ${id} AND tenant_id = ${ctx.tenantId}
      `))) as unknown as Array<{ version: number; status: string }>;
      if (
        body.version !== undefined &&
        current &&
        current.version !== body.version &&
        current.status !== "closed" &&
        current.status !== "cancelled"
      ) {
        throw new HttpError(
          409,
          "VERSION_CONFLICT",
          "service request was changed by someone else; reload and try again",
        );
      }
      throw new HttpError(404, "NOT_FOUND", "service request not found or already closed");
    }
    // `fromStatus` is an internal join used to write the timeline — not part of
    // the SR view contract. Strip it before returning.
    const data: Record<string, unknown> = { ...(rows[0] as Record<string, unknown>) };
    delete data["fromStatus"];

    // GAP-CRM-SERVICE-REQUESTS-DETAIL-04: tell the officer what happens to the
    // citizen notice. Only meaningful on resolve/close. "queued" means a message
    // is on its way - the delivery RESULT arrives later and is shown on the
    // request (citizenNotification); "no_contact" means there is no phone or
    // email on file, so nothing was or will be sent.
    const notifyChannel = data["notifyChannel"] as string | null;
    const notifyOutcome = data["notifyOutcome"] as string | null;
    delete data["notifyChannel"];
    delete data["notifyOutcome"];
    if (body.status === "resolved" || body.status === "closed") {
      data["notification"] =
        notifyOutcome === "no_contact"
          ? { state: "no_contact", channel: null }
          : { state: "queued", channel: notifyChannel };
    }
    return reply.send({ data });
  });

  // PATCH /v1/crm/service-requests/:id/assign — GAP-CRM-SERVICE-REQUESTS-DETAIL-05.
  // Assign or reassign the officer responsible for a request. Managers only (the
  // same tier that may close or cancel); the new owner must be an ACTIVE user of
  // the caller's tenant (identity-service is the source of truth, and the check
  // fails CLOSED if it cannot be made). Optimistic-locked like the status PATCH,
  // and audited in the same transaction as the write.
  app.patch(
    "/v1/crm/service-requests/:id/assign",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const ctx = resolveContext(req);
      requireRole(ctx, ADMIN_ROLES);
      const { id } = idParam.parse(req.params);
      const body = assignBody.parse(req.body);

      const active = await isActiveTenantUser(ctx.tenantId, body.assignedTo);
      if (active === undefined) {
        throw new HttpError(503, "IDENTITY_UNAVAILABLE", "could not verify the officer; try again");
      }
      if (!active) {
        throw new HttpError(422, "INVALID_ASSIGNEE", "assignedTo must be an active user in this tenant");
      }

      const versionF = body.version !== undefined ? sql`AND version = ${body.version}` : sql``;
      const rows = (await scopedRead(async (tx) => {
        const updated = (await tx.execute(sql`
          WITH prev AS (
            SELECT assigned_to FROM crm.service_requests
            WHERE id = ${id} AND tenant_id = ${ctx.tenantId}
          )
          UPDATE crm.service_requests
          SET assigned_to = ${body.assignedTo}::uuid,
              updated_by = ${ctx.actorId}, updated_at = now(), version = version + 1
          WHERE id = ${id} AND tenant_id = ${ctx.tenantId}
            AND status NOT IN ('closed', 'cancelled')
            ${versionF}
          RETURNING id, status, assigned_to AS "assignedTo",
                    (SELECT assigned_to FROM prev) AS "fromAssignee", version
        `)) as unknown as Array<Record<string, unknown>>;

        if (updated.length > 0) {
          await emitWithAudit(tx, ctx, {
            eventType: EVENTS.serviceRequestAssigned,
            action: "assign",
            resourceType: "service_request",
            resourceId: id,
            payload: {
              serviceRequestId: id,
              fromAssignee: (updated[0]?.["fromAssignee"] as string | null) ?? null,
              toAssignee: body.assignedTo,
            },
          });
        }
        return updated;
      })) as unknown as Array<Record<string, unknown>>;

      if (rows.length === 0) {
        const [current] = (await scopedRead((tx) => tx.execute(sql`
          SELECT version, status FROM crm.service_requests
          WHERE id = ${id} AND tenant_id = ${ctx.tenantId}
        `))) as unknown as Array<{ version: number; status: string }>;
        if (
          body.version !== undefined &&
          current &&
          current.version !== body.version &&
          current.status !== "closed" &&
          current.status !== "cancelled"
        ) {
          throw new HttpError(
            409,
            "VERSION_CONFLICT",
            "service request was changed by someone else; reload and try again",
          );
        }
        throw new HttpError(404, "NOT_FOUND", "service request not found or already closed");
      }
      const data: Record<string, unknown> = { ...(rows[0] as Record<string, unknown>) };
      delete data["fromAssignee"];
      return reply.send({ data });
    },
  );
}
