import { createHash } from "node:crypto";

export type AuditEventView = {
  id: string;
  tenantId: string;
  type: string;
  actor: Record<string, unknown>;
  target: string | null;
  payload: Record<string, unknown>;
  severity: string;
  prevHash: string | null;
  eventHash: string | null;
  correlationId: string | null;
  occurredAt: string;
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
