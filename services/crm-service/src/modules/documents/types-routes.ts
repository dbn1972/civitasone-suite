/**
 * DM-002 — document type catalogue admin (mandatory / expiry / verification config).
 *   GET    /v1/crm/document-types        — the tenant's types
 *   POST   /v1/crm/document-types         — create a type (admin, audited)
 *   PUT    /v1/crm/document-types/:id      — amend a type (admin, audited)
 *   DELETE /v1/crm/document-types/:id      — remove a type (admin, audited)
 *
 * Low-volume admin config, so writes are synchronous + transactionally audited
 * (the task-escalation-rules / reason-codes pattern), not domain events.
 */
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { sql } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { enqueue } from "../../shared/outbox.js";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { createDocumentTypeBody, updateDocumentTypeBody, idParam } from "./validators.js";

const CRM_ROLES = ["crm_user", "crm_admin", "super_admin", "tenant_admin"];
const ADMIN_ROLES = ["crm_admin", "tenant_admin", "super_admin"];
const AUDIT = "audit.event.record";

const SELECT_COLS = sql`
  id, code, name, applies_to AS "appliesTo", mandatory, expiry_required AS "expiryRequired",
  verification_required AS "verificationRequired", enabled,
  created_at AS "createdAt", updated_at AS "updatedAt", version`;

/**
 * Format a JS string array as a Postgres array literal for binding into a raw `sql`
 * template. Passing the array value itself as a parameter does NOT work here — it
 * arrives at Postgres as the bare joined string (e.g. `["contact"]` becomes just
 * `contact`, not `{contact}`), which fails as "malformed array literal" even with an
 * explicit `::varchar(16)[]` cast on the parameter. Same technique already used by
 * workflow-service's external-tasks/repo.ts for the identical problem. `appliesTo`
 * values are already validated against the fixed 6-item SUBJECT_TYPES enum (no commas,
 * quotes or braces possible), but this escapes them anyway rather than assume that.
 */
function pgArrayLiteral(values: readonly string[]): string {
  return `{${values.map((v) => `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`).join(",")}}`;
}

export async function documentTypeRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/crm/document-types", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const rows = (await scopedRead((tx) => tx.execute(sql`
      SELECT ${SELECT_COLS} FROM crm.document_types
      WHERE tenant_id = ${ctx.tenantId} ORDER BY applies_to, code
    `))) as unknown as Array<Record<string, unknown>>;
    return reply.send({ data: rows, meta: { total: rows.length } });
  });

  app.post("/v1/crm/document-types", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const b = createDocumentTypeBody.parse(req.body);
    const row = await db.transaction(async (tx) => {
      const inserted = (await tx.execute(sql`
        INSERT INTO crm.document_types
          (tenant_id, code, name, applies_to, mandatory, expiry_required, verification_required, enabled, created_by, updated_by)
        VALUES (${ctx.tenantId}, ${b.code}, ${b.name}, ${pgArrayLiteral(b.appliesTo)}::varchar(16)[], ${b.mandatory},
                ${b.expiryRequired}, ${b.verificationRequired}, ${b.enabled}, ${ctx.actorId}, ${ctx.actorId})
        ON CONFLICT (tenant_id, code) DO NOTHING
        RETURNING ${SELECT_COLS}
      `)) as unknown as Array<Record<string, unknown>>;
      if (inserted.length === 0) return null;
      await enqueue(tx, {
        topic: AUDIT, eventType: AUDIT, tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId,
        payload: { service: "crm", action: "document_type_create", resourceType: "document_type", resourceId: String(inserted[0]?.id), outcome: "success" },
      });
      return inserted[0];
    });
    if (!row) throw new HttpError(409, "CONFLICT", "a document type with this code already exists");
    return reply.code(201).send({ data: row });
  });

  app.put("/v1/crm/document-types/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const b = updateDocumentTypeBody.parse(req.body);
    const sets = [] as ReturnType<typeof sql>[];
    if (b.name !== undefined) sets.push(sql`name = ${b.name}`);
    if (b.appliesTo !== undefined) sets.push(sql`applies_to = ${pgArrayLiteral(b.appliesTo)}::varchar(16)[]`);
    if (b.mandatory !== undefined) sets.push(sql`mandatory = ${b.mandatory}`);
    if (b.expiryRequired !== undefined) sets.push(sql`expiry_required = ${b.expiryRequired}`);
    if (b.verificationRequired !== undefined) sets.push(sql`verification_required = ${b.verificationRequired}`);
    if (b.enabled !== undefined) sets.push(sql`enabled = ${b.enabled}`);
    sets.push(sql`updated_at = now()`);
    sets.push(sql`updated_by = ${ctx.actorId}`);
    sets.push(sql`version = version + 1`);
    const row = await db.transaction(async (tx) => {
      const updated = (await tx.execute(sql`
        UPDATE crm.document_types SET ${sql.join(sets, sql`, `)}
        WHERE id = ${id} AND tenant_id = ${ctx.tenantId}
        RETURNING ${SELECT_COLS}
      `)) as unknown as Array<Record<string, unknown>>;
      if (updated.length === 0) return null;
      await enqueue(tx, {
        topic: AUDIT, eventType: AUDIT, tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId,
        payload: { service: "crm", action: "document_type_update", resourceType: "document_type", resourceId: id, outcome: "success" },
      });
      return updated[0];
    });
    if (!row) throw new HttpError(404, "NOT_FOUND", "document type not found");
    return reply.send({ data: row });
  });

  app.delete("/v1/crm/document-types/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const deleted = await db.transaction(async (tx) => {
      const rows = (await tx.execute(sql`
        DELETE FROM crm.document_types WHERE id = ${id} AND tenant_id = ${ctx.tenantId} RETURNING id
      `)) as unknown as Array<{ id: string }>;
      if (rows.length === 0) return false;
      await enqueue(tx, {
        topic: AUDIT, eventType: AUDIT, tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId,
        payload: { service: "crm", action: "document_type_delete", resourceType: "document_type", resourceId: id, outcome: "success" },
      });
      return true;
    });
    if (!deleted) throw new HttpError(404, "NOT_FOUND", "document type not found");
    return reply.code(204).send();
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({
        code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false,
        fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
      });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
