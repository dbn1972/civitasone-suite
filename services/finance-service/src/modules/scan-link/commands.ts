/**
 * Scan-link (Finance target) -- audit-on-read (DPDP).
 *
 * Viewing a record's scanned documents exposes masked content/previews, so every successful view is audited.
 * Routes must not write the DB, so the event is PUBLISHED on the queue (`audit.event.record`), the same way
 * other non-mutation finance audits are emitted. The event carries ONLY: actor (envelope), tenant, the target
 * (resourceType/resourceId), the document id(s), a fixed purpose and the route. Never a preview, name or PII.
 * Fail-closed: if the audit cannot be published the view fails (the caller sees an error, no content).
 */
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import type { ScanTargetKind } from "./match.js";

const AUDIT_TOPIC = "audit.event.record";
export const VIEW_PURPOSE = "view_scanned_documents";

export async function auditScannedDocumentsView(
  ctx: Pick<RequestContext, "tenantId" | "actorId" | "correlationId">,
  v: { kind: ScanTargetKind; targetId: string; documentIds: string[]; route: string },
): Promise<void> {
  if (v.documentIds.length === 0) return; // nothing was exposed
  await queue.publish(AUDIT_TOPIC, {
    messageId: randomUUID(), type: AUDIT_TOPIC,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: {
      service: "finance", action: VIEW_PURPOSE, resourceType: v.kind, resourceId: v.targetId, outcome: "success",
      details: { purpose: VIEW_PURPOSE, documentIds: v.documentIds, route: v.route },
    },
  });
}
