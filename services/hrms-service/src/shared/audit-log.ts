/**
 * Local HR audit log — records all write operations within the HRMS database.
 *
 * This provides a co-located, tamper-evident audit trail required by:
 *   - CERT-In Directions 2022 (structured audit logs, 180-day retention)
 *   - State Government Service Rules (accountability for HR decisions)
 *   - e-Governance Guidelines (traceable approval chains)
 *
 * The local log supplements (does not replace) the central audit-service.
 * It ensures auditability even if the audit-service queue is lagging.
 *
 * Usage:
 *   import { auditLog } from "../../shared/audit-log.js";
 *   await auditLog(tx, { tenantId, actorId, action: "approve", resourceType: "leave_app", resourceId });
 */
import { pgSchema, uuid, text, varchar, jsonb, timestamp } from "drizzle-orm/pg-core";
import type { RequestContext } from "@civitasone/types";
import { runWithTenant } from "@civitasone/db";
import { db } from "./db.js";

const employeeSchema = pgSchema("employee");

export const hrmsAuditLog = employeeSchema.table("hrms_audit_log", {
  id:            uuid("id").primaryKey().defaultRandom(),
  tenantId:      uuid("tenant_id").notNull(),
  actorId:       uuid("actor_id").notNull(),
  actorName:     text("actor_name"),
  action:        varchar("action", { length: 64 }).notNull(),
  resourceType:  varchar("resource_type", { length: 64 }).notNull(),
  resourceId:    uuid("resource_id"),
  payload:       jsonb("payload"),
  ipAddress:     varchar("ip_address", { length: 45 }),
  correlationId: varchar("correlation_id", { length: 64 }),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export interface AuditEntry {
  tenantId: string;
  actorId: string;
  actorName?: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  payload?: Record<string, unknown>;
  ipAddress?: string;
  correlationId?: string;
}

/**
 * Write an audit log entry. Can be called within a transaction (tx) or standalone.
 * Never throws — audit failures are logged but do not block the operation.
 */
export async function auditLog(txOrDb: typeof db, entry: AuditEntry): Promise<void> {
  try {
    await txOrDb.insert(hrmsAuditLog).values({
      tenantId: entry.tenantId,
      actorId: entry.actorId,
      actorName: entry.actorName ?? null,
      action: entry.action,
      resourceType: entry.resourceType,
      resourceId: entry.resourceId ?? null,
      payload: entry.payload ?? null,
      ipAddress: entry.ipAddress ?? null,
      correlationId: entry.correlationId ?? null,
    });
  } catch (err) {
    // Audit must never block business operations. Log and continue.
    // The central audit-service (outbox) is the primary audit record.
    const { pino: pinoFactory } = await import("pino");
    const log = pinoFactory({ name: "hrms-audit-log" });
    log.error({ err, entry }, "failed to write local audit log entry");
  }
}

/**
 * Fastify onResponse hook factory — automatically logs all mutating requests.
 * Attach via: app.addHook("onResponse", auditHook);
 */
export function createAuditHook() {
  return async (req: { method: string; url: string; headers: Record<string, unknown>; id: string }, reply: { statusCode: number }): Promise<void> => {
    // Only audit mutating operations that succeeded
    const method = req.method.toUpperCase();
    if (!["POST", "PATCH", "PUT", "DELETE"].includes(method)) return;
    if (reply.statusCode >= 400) return;

    // Extract context from headers (set by authPlugin after verification)
    const tenantId = req.headers["x-tenant-id"] as string;
    const actorId = req.headers["x-actor-id"] as string;
    if (!tenantId || !actorId) return;

    // Derive resource type from URL path
    const urlParts = (req.url.split("?")[0] ?? "").split("/").filter(Boolean);
    // Pattern: /v1/hrms/{resourceType}[/{id}]
    const resourceType = urlParts[2] ?? "unknown";
    const resourceId = urlParts[3] && urlParts[3].match(/^[0-9a-f-]{36}$/i) ? urlParts[3] : undefined;

    const actionMap: Record<string, string> = { POST: "create", PATCH: "update", PUT: "replace", DELETE: "delete" };
    const action = actionMap[method] ?? method.toLowerCase();

    // SEC-010: employee.hrms_audit_log is now FORCE RLS'd. This hook used to
    // call auditLog(db, {...}) directly -- a bare, non-transactional insert
    // with no app.tenant_id GUC, which FORCE RLS's WITH CHECK now rejects on
    // EVERY mutating request fleet-wide (auditLog's own try/catch swallows
    // the error, so this failure would otherwise be completely silent --
    // no crash, no visible symptom, just a service-wide-disabled audit
    // trail). This hook runs as a Fastify onResponse callback, not inline
    // inside a route handler, so it cannot rely on ambient AsyncLocalStorage
    // tenant context surviving from an earlier hook -- explicitly
    // establish it with runWithTenant, the documented pattern for exactly
    // this "worker/hook, not a request handler" shape (see
    // packages/db/src/tenant-context.ts's own doc comment). db.transaction
    // inside that scope then has wrapWithTenantGuc set the GUC, same as
    // every scopedRead()/db.transaction() call elsewhere in this service.
    try {
      await runWithTenant(tenantId, () =>
        db.transaction((tx) =>
          auditLog(tx, {
            tenantId,
            actorId,
            action,
            resourceType,
            ...(resourceId !== undefined ? { resourceId } : {}),
            correlationId: (req.headers["x-correlation-id"] as string | undefined) ?? req.id,
            ...(() => { const ip = (req.headers["x-forwarded-for"] as string | undefined) ?? (req.headers["x-real-ip"] as string | undefined); return ip !== undefined ? { ipAddress: ip } : {}; })(),
          }),
        ),
      );
    } catch (err) {
      // Belt-and-suspenders: auditLog() already catches the insert itself,
      // but this also guards the transaction/GUC setup around it. Audit
      // must never block or fail the response it's describing.
      const { pino: pinoFactory } = await import("pino");
      const log = pinoFactory({ name: "hrms-audit-log" });
      log.error({ err }, "failed to open tenant-scoped transaction for audit log hook");
    }
  };
}
