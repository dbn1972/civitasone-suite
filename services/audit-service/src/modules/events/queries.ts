import { cache } from "../../shared/infra.js";
import { RESOURCE } from "../../topics.js";
import * as repo from "./repo.js";
import type { AuditEventView } from "./domain.js";

export async function getEvent(tenantId: string, id: string): Promise<AuditEventView | null> {
  try {
    return await cache.getOrLoad<AuditEventView>(
      cache.makeKey(tenantId, RESOURCE.event, id),
      () => repo.findById(id, tenantId),
    );
  } catch {
    // Cache unavailable (e.g. Redis down in staging) — fall through to DB directly.
    return repo.findById(id, tenantId);
  }
}

export async function listEvents(tenantId: string, from: Date, to: Date, type?: string, limit = 50, offset = 0): Promise<AuditEventView[]> {
  return repo.listEvents(tenantId, from, to, type, limit, offset);
}

/** Return the audit trail for a specific entity (entityType + entityId). */
export async function listEventsByEntity(
  tenantId: string,
  resourceType: string,
  resourceId: string,
  limit = 50,
  offset = 0,
): Promise<AuditEventView[]> {
  return repo.listEventsByEntity(tenantId, resourceType, resourceId, limit, offset);
}

/** Directly write an audit event (API path; queue preferred for cross-service events). */
export async function writeEvent(
  tenantId: string,
  actorId: string,
  type: string,
  resourceType: string,
  resourceId: string,
  severity: string,
  payload: Record<string, unknown>,
  correlationId: string,
  ipAddress?: string | null,
  userAgent?: string | null,
): Promise<string> {
  return repo.writeEvent(tenantId, actorId, type, resourceType, resourceId, severity, payload, correlationId, ipAddress, userAgent);
}
