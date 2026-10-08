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
      return inserted[0];
    });
    return reply.code(201).send({ data: row });
  });

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
             r.contact_id AS "contactId", r.resolution, r.status_note AS "statusNote",
             r.intake_channel AS "intakeChannel",
             r.due_at AS "dueAt", r.resolved_at AS "resolvedAt",
             r.closed_at AS "closedAt",
             r.created_at AS "createdAt", r.updated_at AS "updatedAt",
             r.created_by AS "createdBy", r.version
      FROM crm.service_requests r
      WHERE r.id = ${id} AND r.tenant_id = ${ctx.tenantId}
    `))) as unknown as Array<Record<string, unknown>>;

    if (rows.length === 0) throw new HttpError(404, "NOT_FOUND", "service request not found");
    return reply.send({ data: maskRecord("service_request", rows[0]!, ctx.roles) });
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
            resolved_at = CASE WHEN ${body.status} = 'resolved' AND resolved_at IS NULL THEN now() ELSE resolved_at END,
            closed_at   = CASE WHEN ${body.status} IN ('closed', 'cancelled') AND closed_at IS NULL THEN now() ELSE closed_at END,
            updated_by = ${ctx.actorId}, updated_at = now(), version = version + 1
        WHERE id = ${id} AND tenant_id = ${ctx.tenantId}
          AND status NOT IN ('closed', 'cancelled')
          ${versionF}
        RETURNING id, status, (SELECT status FROM prev) AS "fromStatus",
                  assigned_to AS "assignedTo", resolved_at AS "resolvedAt",
                  closed_at AS "closedAt", resolution, status_note AS "statusNote", version
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
    return reply.send({ data });
  });
}
