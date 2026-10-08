import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { scopedRead } from "../../shared/db.js";
import { listQuery, windowOf, listEnvelope } from "../../shared/list-query.js";
import { maskList, maskRecord } from "../../shared/pii-reveal.js";
import { emitWithAudit } from "../../shared/route-audit.js";
import { EVENTS } from "../../topics.js";
import {
  STATUS,
  PRIORITY,
  MINISTRY_CODE,
  createBody,
  assignBody,
  resolveBody,
  forwardBody,
  appealBody,
} from "./grievances-domain.js";

const CRM_ROLES = ["crm_user", "crm_admin", "super_admin", "tenant_admin"];
const ADMIN_ROLES = ["crm_admin", "super_admin", "tenant_admin"];

/**
 * F3-02 optimistic concurrency: read the optional `If-Match` precondition from the
 * request. The web (GrievanceActions.tsx) sends the version it rendered as `If-Match`
 * on every lifecycle PATCH; the server is the authority. Weak-validator (`W/`) and
 * surrounding quotes are stripped so `7`, `"7"` and `W/"7"` all resolve to 7. Returns
 * `undefined` when no header is sent (back-compat: the write proceeds unconditionally).
 */
function ifMatchVersion(req: FastifyRequest): number | undefined {
  const raw = req.headers["if-match"];
  if (typeof raw !== "string") return undefined;
  const cleaned = raw.replace(/^W\//, "").replace(/^"|"$/g, "").trim();
  if (cleaned === "") return undefined;
  const n = Number(cleaned);
  if (!Number.isInteger(n) || n < 0) {
    throw new HttpError(400, "INVALID_IF_MATCH", "If-Match must be an integer version");
  }
  return n;
}

/**
 * F3-02: when a version-guarded lifecycle UPDATE affects no rows AND an `If-Match`
 * precondition was supplied, disambiguate "row gone/terminal" (404) from "someone else
 * advanced it since you loaded" (412 PRECONDITION_FAILED). Only called on the 0-row path,
 * so it never adds a query to the happy path.
 */
async function raiseConflictOrNotFound(
  tenantId: string,
  id: string,
  ifMatch: number,
  notFoundMessage: string,
): Promise<never> {
  const rows = (await scopedRead((tx) => tx.execute(sql`
    SELECT version FROM crm.grievances WHERE id = ${id} AND tenant_id = ${tenantId}
  `))) as unknown as Array<{ version: number }>;
  if (rows.length > 0 && rows[0]!.version !== ifMatch) {
    throw new HttpError(412, "PRECONDITION_FAILED", "grievance was modified by someone else");
  }
  throw new HttpError(404, "NOT_FOUND", notFoundMessage);
}

const listParams = listQuery.extend({
  status: z.enum(STATUS).optional(),
  priority: z.enum(PRIORITY).optional(),
  category: z.string().max(64).optional(),
  assignedTo: z.string().uuid().optional(),
  search: z.string().max(200).optional(),
});

const idParam = z.object({ id: z.string().uuid() });

export async function grievanceRoutes(app: FastifyInstance): Promise<void> {
  // POST /v1/crm/grievances — create grievance with CPGRAMS-aligned reference number
  app.post("/v1/crm/grievances", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const body = createBody.parse(req.body);

    const rows = (await scopedRead(async (tx) => {
      // Ministry-prefixed reference: DARPG/2026/000001
      const [seqRow] = (await tx.execute(
        sql`SELECT nextval('"crm"."grievance_ref_seq"')::bigint AS seq`
      )) as Array<{ seq: number }>;
      const yr = new Date().getFullYear();
      const seq = Number(seqRow!.seq).toString().padStart(6, "0");
      const refNo = `${MINISTRY_CODE}/${yr}/${seq}`;

      const inserted = (await tx.execute(sql`
        INSERT INTO crm.grievances (
          tenant_id, contact_id, citizen_name, citizen_phone, citizen_email,
          category, subject, description, priority, status,
          due_at, reference_no, created_by, updated_by
        ) VALUES (
          ${ctx.tenantId}, ${body.contactId ?? null}, ${body.citizenName},
          ${body.citizenPhone ?? null}, ${body.citizenEmail ?? null},
          ${body.category}, ${body.subject}, ${body.description ?? null},
          ${body.priority}, 'REGISTERED',
          ${body.dueAt ?? null}, ${refNo}, ${ctx.actorId}, ${ctx.actorId}
        )
        RETURNING id, reference_no AS "referenceNo",
                  citizen_name AS "citizenName", category, subject,
                  priority, status, created_at AS "createdAt"
      `)) as unknown as Array<Record<string, unknown>>;
      // GAP2-CRM-GRIEVANCES-AUDIT-01: emit the domain + audit event in the SAME
      // tx as the write so the tamper-evident trail commits/rolls back with the
      // row. Payload carries NO citizen PII (name/phone/email).
      await emitWithAudit(tx, ctx, {
        eventType: EVENTS.grievanceRegistered,
        action: "register",
        resourceType: "grievance",
        resourceId: String(inserted[0]?.["id"]),
        payload: { grievanceId: String(inserted[0]?.["id"]), status: "REGISTERED", category: body.category },
      });
      return inserted;
    })) as unknown as Array<Record<string, unknown>>;
    return reply.code(201).send({ data: rows[0] });
  });

  // GET /v1/crm/grievances — list with CPGRAMS status filters
  app.get("/v1/crm/grievances", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const q = listParams.parse(req.query ?? {});
    const w = windowOf(q);

    const statusF   = q.status     ? sql`AND g.status    = ${q.status}`               : sql``;
    const priorityF = q.priority   ? sql`AND g.priority  = ${q.priority}`             : sql``;
    const categoryF = q.category   ? sql`AND g.category  = ${q.category}`             : sql``;
    const assignedF = q.assignedTo ? sql`AND g.assigned_to = ${q.assignedTo}::uuid`   : sql``;
    const searchF   = q.search
      ? sql`AND (g.citizen_name ILIKE ${"%" + q.search + "%"}
                 OR g.subject   ILIKE ${"%" + q.search + "%"}
                 OR g.reference_no ILIKE ${"%" + q.search + "%"})`
      : sql``;

    const rows = (await scopedRead((tx) => tx.execute(sql`
      SELECT g.id, g.reference_no AS "referenceNo", g.citizen_name AS "citizenName",
             g.citizen_phone AS "citizenPhone", g.citizen_email AS "citizenEmail",
             g.category, g.subject, g.priority, g.status,
             g.assigned_to AS "assignedTo", g.contact_id AS "contactId",
             g.due_at AS "dueAt", g.resolved_at AS "resolvedAt",
             g.escalated_at AS "escalatedAt",
             g.created_at AS "createdAt", g.updated_at AS "updatedAt", g.version
      FROM crm.grievances g
      WHERE g.tenant_id = ${ctx.tenantId}
        ${statusF} ${priorityF} ${categoryF} ${assignedF} ${searchF}
      ORDER BY
        CASE g.priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'normal' THEN 3 ELSE 4 END,
        g.created_at DESC
      LIMIT ${w.pageSize} OFFSET ${w.offset}
    `))) as unknown as Array<Record<string, unknown>>;

    const [ct] = (await scopedRead((tx) => tx.execute(sql`
      SELECT COUNT(*)::int AS total FROM crm.grievances g
      WHERE g.tenant_id = ${ctx.tenantId}
        ${statusF} ${priorityF} ${categoryF} ${assignedF} ${searchF}
    `))) as unknown as Array<{ total: number }>;

    return reply.send(listEnvelope(maskList("grievance", rows, ctx.roles), w, ct?.total ?? 0));
  });

  // GET /v1/crm/grievances/stats — KPIs (must register before /:id to avoid routing conflict)
  app.get("/v1/crm/grievances/stats", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);

    const [row] = (await scopedRead((tx) => tx.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE status != 'DISPOSED')::int          AS "openCount",
        COUNT(*) FILTER (WHERE status = 'DISPOSED'
                           AND resolved_at IS NOT NULL)::int       AS "resolvedCount",
        COUNT(*) FILTER (WHERE status = 'APPEAL')::int             AS "escalatedCount",
        ROUND(
          AVG(EXTRACT(EPOCH FROM (resolved_at - created_at)) / 3600)
          FILTER (WHERE resolved_at IS NOT NULL)
        )::int                                                     AS "avgResolutionHours"
      FROM crm.grievances
      WHERE tenant_id = ${ctx.tenantId}
    `))) as unknown as Array<Record<string, unknown>>;

    return reply.send({
      data: row ?? { openCount: 0, resolvedCount: 0, escalatedCount: 0, avgResolutionHours: null },
    });
  });

  // GET /v1/crm/grievances/:id — detail (exposes forwarded_to, appeal_reason)
  app.get("/v1/crm/grievances/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const { id } = idParam.parse(req.params);

    const rows = (await scopedRead((tx) => tx.execute(sql`
      SELECT g.id, g.reference_no AS "referenceNo", g.citizen_name AS "citizenName",
             g.citizen_phone AS "citizenPhone", g.citizen_email AS "citizenEmail",
             g.category, g.subject, g.description, g.priority, g.status,
             g.assigned_to AS "assignedTo", g.contact_id AS "contactId",
             g.resolution, g.due_at AS "dueAt",
             g.resolved_at AS "resolvedAt", g.closed_at AS "closedAt",
             g.escalated_at AS "escalatedAt",
             g.forwarded_to AS "forwardedTo", g.forwarded_at AS "forwardedAt",
             g.appeal_reason AS "appealReason",
             g.created_at AS "createdAt", g.updated_at AS "updatedAt",
             g.created_by AS "createdBy", g.version
      FROM crm.grievances g
      WHERE g.id = ${id} AND g.tenant_id = ${ctx.tenantId}
    `))) as unknown as Array<Record<string, unknown>>;

    if (rows.length === 0) throw new HttpError(404, "NOT_FOUND", "grievance not found");
    return reply.send({ data: maskRecord("grievance", rows[0]!, ctx.roles) });
  });

  // PATCH /v1/crm/grievances/:id/assign
  app.patch("/v1/crm/grievances/:id/assign", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const { id } = idParam.parse(req.params);
    const body = assignBody.parse(req.body);
    const ifMatch = ifMatchVersion(req);
    const versionF = ifMatch !== undefined ? sql`AND version = ${ifMatch}` : sql``;

    const rows = (await scopedRead(async (tx) => {
      const updated = (await tx.execute(sql`
      UPDATE crm.grievances
      SET assigned_to = ${body.assignedTo}::uuid,
          status = CASE WHEN status = 'REGISTERED' THEN 'FORWARDED' ELSE status END,
          updated_by = ${ctx.actorId}, updated_at = now(), version = version + 1
      WHERE id = ${id} AND tenant_id = ${ctx.tenantId} ${versionF}
      RETURNING id, status, assigned_to AS "assignedTo", version
    `)) as unknown as Array<Record<string, unknown>>;
      if (updated.length > 0) {
        await emitWithAudit(tx, ctx, {
          eventType: EVENTS.grievanceAssigned,
          action: "assign",
          resourceType: "grievance",
          resourceId: id,
          payload: { grievanceId: id, status: String(updated[0]?.["status"]) },
        });
      }
      return updated;
    })) as unknown as Array<Record<string, unknown>>;

    if (rows.length === 0) {
      if (ifMatch !== undefined) await raiseConflictOrNotFound(ctx.tenantId, id, ifMatch, "grievance not found");
      throw new HttpError(404, "NOT_FOUND", "grievance not found");
    }
    return reply.send({ data: rows[0] });
  });

  // PATCH /v1/crm/grievances/:id/forward — CPGRAMS: forward to department/office
  app.patch("/v1/crm/grievances/:id/forward", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const { id } = idParam.parse(req.params);
    const body = forwardBody.parse(req.body);
    const ifMatch = ifMatchVersion(req);
    const versionF = ifMatch !== undefined ? sql`AND version = ${ifMatch}` : sql``;

    const rows = (await scopedRead(async (tx) => {
      const updated = (await tx.execute(sql`
      UPDATE crm.grievances
      SET status = 'FORWARDED',
          forwarded_to = ${body.forwardedTo},
          forwarded_at = now(),
          updated_by = ${ctx.actorId}, updated_at = now(), version = version + 1
      WHERE id = ${id} AND tenant_id = ${ctx.tenantId}
        AND status != 'DISPOSED' ${versionF}
      RETURNING id, status,
                forwarded_to AS "forwardedTo", forwarded_at AS "forwardedAt",
                version
    `)) as unknown as Array<Record<string, unknown>>;
      if (updated.length > 0) {
        await emitWithAudit(tx, ctx, {
          eventType: EVENTS.grievanceForwarded,
          action: "forward",
          resourceType: "grievance",
          resourceId: id,
          payload: { grievanceId: id, status: "FORWARDED", forwardedTo: body.forwardedTo },
        });
      }
      return updated;
    })) as unknown as Array<Record<string, unknown>>;

    if (rows.length === 0) {
      if (ifMatch !== undefined) await raiseConflictOrNotFound(ctx.tenantId, id, ifMatch, "grievance not found or already disposed");
      throw new HttpError(404, "NOT_FOUND", "grievance not found or already disposed");
    }
    return reply.send({ data: rows[0] });
  });

  // PATCH /v1/crm/grievances/:id/resolve — sets DISPOSED (CPGRAMS: attended and disposed)
  app.patch("/v1/crm/grievances/:id/resolve", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const { id } = idParam.parse(req.params);
    const body = resolveBody.parse(req.body);
    const ifMatch = ifMatchVersion(req);
    const versionF = ifMatch !== undefined ? sql`AND version = ${ifMatch}` : sql``;

    const rows = (await scopedRead(async (tx) => {
      const updated = (await tx.execute(sql`
      UPDATE crm.grievances
      SET status = 'DISPOSED', resolution = ${body.resolution},
          resolved_at = now(),
          updated_by = ${ctx.actorId}, updated_at = now(), version = version + 1
      WHERE id = ${id} AND tenant_id = ${ctx.tenantId}
        AND status != 'DISPOSED' ${versionF}
      RETURNING id, status, resolved_at AS "resolvedAt", version
    `)) as unknown as Array<Record<string, unknown>>;
      if (updated.length > 0) {
        await emitWithAudit(tx, ctx, {
          eventType: EVENTS.grievanceResolved,
          action: "resolve",
          resourceType: "grievance",
          resourceId: id,
          payload: { grievanceId: id, status: "DISPOSED" },
        });
      }
      return updated;
    })) as unknown as Array<Record<string, unknown>>;

    if (rows.length === 0) {
      if (ifMatch !== undefined) await raiseConflictOrNotFound(ctx.tenantId, id, ifMatch, "grievance not found or already disposed");
      throw new HttpError(404, "NOT_FOUND", "grievance not found or already disposed");
    }
    return reply.send({ data: rows[0] });
  });

  // PATCH /v1/crm/grievances/:id/close — admin: administratively dispose
  app.patch("/v1/crm/grievances/:id/close", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const ifMatch = ifMatchVersion(req);
    const versionF = ifMatch !== undefined ? sql`AND version = ${ifMatch}` : sql``;

    const rows = (await scopedRead(async (tx) => {
      const updated = (await tx.execute(sql`
      UPDATE crm.grievances
      SET status = 'DISPOSED', closed_at = now(),
          updated_by = ${ctx.actorId}, updated_at = now(), version = version + 1
      WHERE id = ${id} AND tenant_id = ${ctx.tenantId}
        AND status != 'DISPOSED' ${versionF}
      RETURNING id, status, closed_at AS "closedAt", version
    `)) as unknown as Array<Record<string, unknown>>;
      if (updated.length > 0) {
        await emitWithAudit(tx, ctx, {
          eventType: EVENTS.grievanceClosed,
          action: "close",
          resourceType: "grievance",
          resourceId: id,
          payload: { grievanceId: id, status: "DISPOSED" },
        });
      }
      return updated;
    })) as unknown as Array<Record<string, unknown>>;

    if (rows.length === 0) {
      if (ifMatch !== undefined) await raiseConflictOrNotFound(ctx.tenantId, id, ifMatch, "grievance not found or already disposed");
      throw new HttpError(404, "NOT_FOUND", "grievance not found or already disposed");
    }
    return reply.send({ data: rows[0] });
  });

  // PATCH /v1/crm/grievances/:id/escalate — DEPRECATED legacy alias of
  // /first-appeal. Kept for API back-compat but now shares the exact first-appeal
  // logic (accepts + records `appeal_reason`, emits the same audit event) so the
  // two routes can never diverge into inconsistent statutory records
  // (GAP2-CRM-GRIEVANCES-ESCALATE-05). Prefer /first-appeal.
  app.patch("/v1/crm/grievances/:id/escalate", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const { id } = idParam.parse(req.params);
    const body = appealBody.parse(req.body ?? {});
    const ifMatch = ifMatchVersion(req);
    const versionF = ifMatch !== undefined ? sql`AND version = ${ifMatch}` : sql``;

    const rows = (await scopedRead(async (tx) => {
      const updated = (await tx.execute(sql`
      UPDATE crm.grievances
      SET status = 'APPEAL', priority = 'urgent',
          appeal_reason = ${body.appealReason ?? null},
          escalated_at = now(),
          updated_by = ${ctx.actorId}, updated_at = now(), version = version + 1
      WHERE id = ${id} AND tenant_id = ${ctx.tenantId}
        AND status != 'DISPOSED' ${versionF}
      RETURNING id, status, priority,
                appeal_reason AS "appealReason",
                escalated_at AS "escalatedAt", version
    `)) as unknown as Array<Record<string, unknown>>;
      if (updated.length > 0) {
        await emitWithAudit(tx, ctx, {
          eventType: EVENTS.grievanceAppealed,
          action: "first_appeal",
          resourceType: "grievance",
          resourceId: id,
          payload: { grievanceId: id, status: "APPEAL" },
        });
      }
      return updated;
    })) as unknown as Array<Record<string, unknown>>;

    if (rows.length === 0) {
      if (ifMatch !== undefined) await raiseConflictOrNotFound(ctx.tenantId, id, ifMatch, "grievance not found or already disposed");
      throw new HttpError(404, "NOT_FOUND", "grievance not found or already disposed");
    }
    return reply.send({ data: rows[0] });
  });

  // PATCH /v1/crm/grievances/:id/first-appeal — CPGRAMS: citizen files a first appeal
  app.patch("/v1/crm/grievances/:id/first-appeal", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const { id } = idParam.parse(req.params);
    const body = appealBody.parse(req.body ?? {});
    const ifMatch = ifMatchVersion(req);
    const versionF = ifMatch !== undefined ? sql`AND version = ${ifMatch}` : sql``;

    const rows = (await scopedRead(async (tx) => {
      const updated = (await tx.execute(sql`
      UPDATE crm.grievances
      SET status = 'APPEAL', priority = 'urgent',
          appeal_reason = ${body.appealReason ?? null},
          escalated_at = now(),
          updated_by = ${ctx.actorId}, updated_at = now(), version = version + 1
      WHERE id = ${id} AND tenant_id = ${ctx.tenantId}
        AND status != 'DISPOSED' ${versionF}
      RETURNING id, status, priority,
                appeal_reason AS "appealReason",
                escalated_at AS "escalatedAt", version
    `)) as unknown as Array<Record<string, unknown>>;
      if (updated.length > 0) {
        await emitWithAudit(tx, ctx, {
          eventType: EVENTS.grievanceAppealed,
          action: "first_appeal",
          resourceType: "grievance",
          resourceId: id,
          payload: { grievanceId: id, status: "APPEAL" },
        });
      }
      return updated;
    })) as unknown as Array<Record<string, unknown>>;

    if (rows.length === 0) {
      if (ifMatch !== undefined) await raiseConflictOrNotFound(ctx.tenantId, id, ifMatch, "grievance not found or already disposed");
      throw new HttpError(404, "NOT_FOUND", "grievance not found or already disposed");
    }
    return reply.send({ data: rows[0] });
  });
}
