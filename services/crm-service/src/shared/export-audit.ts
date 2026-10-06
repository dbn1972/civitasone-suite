/**
 * Shared audit emission for F2 server-side audited exports (DPDP accountability).
 *
 * A CSV export is a bulk egress of (often PII-bearing) data, so every download
 * leaves an audit record naming WHO exported WHAT, HOW MANY rows, under WHICH
 * filters and for WHAT stated purpose — never the values themselves.
 *
 * Exports are read paths with no business transaction, so (like
 * contacts.auditBulkExport) the audit event is published directly to the bus
 * rather than through the transactional outbox. The payload carries ids / field
 * names / counts / the operator's purpose only; never a row's PII.
 */
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "./infra.js";

export interface BulkExportAudit {
  /** Audited resource type, e.g. `service_request`, `grievance`, `activity`. */
  resourceType: string;
  /** Audit verb, e.g. `service_requests_bulk_export`. */
  action: string;
  /** Number of rows written to the CSV. */
  rowCount: number;
  /** The operator's stated purpose (min length enforced at the route boundary). */
  purpose: string;
  /** Active filters applied to the export (ids / enums only, never PII). */
  filters?: Record<string, unknown>;
  /** True when PII columns were masked in the output for this caller. */
  masked?: boolean;
}

/**
 * Emit a dedicated audit event for a bulk export. MUST be awaited after the rows
 * have been gathered and before the CSV is returned.
 */
export async function auditBulkExport(ctx: RequestContext, m: BulkExportAudit): Promise<void> {
  await queue.publish("audit.event.record", {
    messageId: randomUUID(),
    type: "audit.event.record",
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: {
      service: "crm",
      action: m.action,
      resourceType: m.resourceType,
      resourceId: ctx.tenantId,
      outcome: "success",
      metadata: {
        recordCount: m.rowCount,
        purpose: m.purpose,
        ...(m.filters ? { filters: m.filters } : {}),
        ...(m.masked !== undefined ? { masked: m.masked } : {}),
      },
    },
  });
}
