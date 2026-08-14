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
      actorName: entry.actorName,
      action: entry.action,
      resourceType: entry.resourceType,
      resourceId: entry.resourceId,
      payload: entry.payload ?? null,
      ipAddress: entry.ipAddress,
      correlationId: entry.correlationId,
    });
  } catch (err) {
    // Audit must never block business operations. Log and continue.
    // The central audit-service (outbox) is the primary audit record.
    const pino = await import("pino");
    const log = pino.default({ name: "hrms-audit-log" });
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

    await auditLog(db, {
      tenantId,
      actorId,
      action,
      resourceType,
      resourceId,
      correlationId: (req.headers["x-correlation-id"] as string) ?? req.id,
      ipAddress: req.headers["x-forwarded-for"] as string ?? req.headers["x-real-ip"] as string,
    });
  };
}
