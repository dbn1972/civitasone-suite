/**
 * Audit-on-read (DPDP). Every view of review content and every download / page view writes ONE audit event.
 *
 * Routes must not write the DB, so the event is PUBLISHED on the queue (`audit.event.record`), the same way
 * the hrms / finance / estab scan-link read routes do. The payload carries ONLY: actor (envelope), tenant,
 * the document id (for a search: a fresh search request id), a fixed purpose, the route and (search) the result count. Never text, names, previews or any PII.
 *
 * FAIL CLOSED: if the publish throws, this throws, the route answers 500 and NO content (and no presigned URL)
 * is released. Callers must `await auditRead(...)` BEFORE touching storage.
 */
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { AUDIT_TOPIC } from "./emit.js";

export type ReadPurpose = "review_view" | "download" | "page_view" | "search";

export async function auditRead(
  ctx: Pick<RequestContext, "tenantId" | "actorId" | "correlationId">,
  v: { purpose: ReadPurpose; documentId: string; route: string; resultCount?: number },
): Promise<void> {
  await queue.publish(AUDIT_TOPIC, {
    messageId: randomUUID(), type: AUDIT_TOPIC,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: {
      service: "document", action: "bulk_scan_" + v.purpose,
      resourceType: v.purpose === "search" ? "document_search" : "document", resourceId: v.documentId, outcome: "success",
      details: { purpose: v.purpose, route: v.route, ...(v.resultCount === undefined ? {} : { resultCount: v.resultCount }) },
    },
  });
}
