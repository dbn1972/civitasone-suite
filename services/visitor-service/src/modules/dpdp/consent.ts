/**
 * visitor-service: DPDP compliance helpers — consent capture + PII access logging.
 *
 * Requirements 18.1, 18.5, 18.6:
 * - logConsent: inserts into visitor.consent_log before any PII write
 * - logPiiAccess: inserts into visitor.pii_access_log + outbox audit.event.record
 *   on every PII read in repo.ts files across modules
 *
 * Both functions accept a DrizzleTx so they can participate in the caller's
 * transaction (consent log before the write, PII access log after the read).
 * For PII access logging in read-only repo functions that run outside a
 * transaction, a top-level `db` import is used as the tx parameter.
 */
import { randomUUID } from "node:crypto";
import type { DrizzleTx } from "../../shared/outbox.js";
import { enqueue } from "../../shared/outbox.js";
import { consentLog, piiAccessLog } from "./schema.js";

/**
 * Requirement 18.1 / 18.5: Record explicit consent before storing visitor PII.
 *
 * @param tx        - Drizzle transaction or db instance
 * @param tenantId  - Tenant UUID
 * @param visitorRef - Non-PII reference to the data subject (tracking ref or internal ID)
 * @param purpose   - Stated purpose (e.g. "visit_management", "security", "emergency_contact")
 * @param dataCollected - Array of field names being collected (e.g. ["name","phone","email"])
 * @param retentionDays - How long data will be retained (default 365)
 */
export async function logConsent(
  tx: DrizzleTx,
  tenantId: string,
  visitorRef: string,
  purpose: string,
  dataCollected: string[] = [],
  retentionDays = 365,
): Promise<void> {
  await tx.insert(consentLog).values({
    id: randomUUID(),
    tenantId,
    visitorRef,
    purpose,
    dataCollected,
    retentionDays,
    consentedAt: new Date(),
    createdAt: new Date(),
  });
}

/**
 * Requirement 18.6: Log every PII read + publish audit.event.record via outbox.
 *
 * @param tx           - Drizzle transaction or db instance
 * @param tenantId     - Tenant UUID
 * @param actorId      - UUID of the user/service account accessing PII
 * @param resourceType - Type of entity whose PII was accessed (e.g. "visit_request", "blacklist")
 * @param resourceId   - UUID of the accessed entity
 * @param purpose      - Stated purpose for the access (e.g. "list_view", "detail_view", "export")
 * @param correlationId - Request correlation ID for tracing
 */
export async function logPiiAccess(
  tx: DrizzleTx,
  tenantId: string,
  actorId: string,
  resourceType: string,
  resourceId: string,
  purpose: string,
  correlationId?: string,
): Promise<void> {
  const accessId = randomUUID();
  const now = new Date();

  await tx.insert(piiAccessLog).values({
    id: accessId,
    tenantId,
    accessorId: actorId,
    resourceType,
    resourceId,
    purpose,
    accessedAt: now,
  });

  // Publish audit event via outbox so audit-service has a record
  await enqueue(tx, {
    topic: "audit.event.record",
    eventType: "pii.access.logged",
    tenantId,
    actorId,
    correlationId: correlationId ?? randomUUID(),
    payload: {
      accessId,
      resourceType,
      resourceId,
      purpose,
      accessedAt: now.toISOString(),
    },
  });
}
