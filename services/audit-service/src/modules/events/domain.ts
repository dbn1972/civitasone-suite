import { createHash } from "node:crypto";

export type AuditEventView = {
  id: string;
  tenantId: string;
  type: string;
  actor: Record<string, unknown>;
  target: string | null;
  payload: Record<string, unknown>;
  // CERT-In required fields
  ipAddress: string | null;
  userAgent: string | null;
  oldValue: Record<string, unknown> | null;
  newValue: Record<string, unknown> | null;
  severity: string;
  prevHash: string | null;
  eventHash: string | null;
  correlationId: string | null;
  occurredAt: string;
  /** ISO-8601 string; computed as occurredAt + 180d if DB column not yet present (pre-migration compat) */
  retainUntil: string;
};

export type IngestPayload = {
  service: string;
  action: string;
  resourceType: string;
  resourceId: string;
  outcome: string;
  [k: string]: unknown;
};

export function computeHash(id: string, tenantId: string, type: string, prevHash: string | null, occurredAt: string): string {
  return createHash("sha256")
    .update(`${id}:${tenantId}:${type}:${prevHash ?? ""}:${occurredAt}`)
    .digest("hex")
    .slice(0, 64);
}
