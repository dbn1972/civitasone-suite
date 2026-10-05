/**
 * F6-01 — shared writer/reader for crm.case_status_history.
 *
 * Service requests and RTI requests both record every status transition into one
 * tenant-scoped table discriminated by `resourceType`. The write MUST happen in
 * the SAME transaction as the status change (pass the caller's `tx`), so the
 * timeline entry commits or rolls back with the transition it describes.
 *
 * Lives in `shared/` rather than inside either module because the table is a
 * cross-module building block (like route-audit.ts): neither the service-requests
 * nor the rti module owns it, and neither imports the other's repo.
 */
import { sql } from "drizzle-orm";
import { scopedRead } from "./db.js";

export type CaseResourceType = "service_request" | "rti_request";

/** Drizzle transaction handle (same shape scopedRead hands its callback). */
type Tx = { execute: (q: ReturnType<typeof sql>) => Promise<unknown> };

/**
 * Append a status-transition row. Call inside the transaction that performs the
 * transition. `fromStatus` is null for the initial transition (creation).
 */
export async function recordStatusHistory(
  tx: Tx,
  args: {
    tenantId: string;
    resourceType: CaseResourceType;
    resourceId: string;
    fromStatus: string | null;
    toStatus: string;
    note: string | null;
    actorId: string;
  },
): Promise<void> {
  await tx.execute(sql`
    INSERT INTO crm.case_status_history
      (tenant_id, resource_type, resource_id, from_status, to_status, note, actor_id)
    VALUES
      (${args.tenantId}, ${args.resourceType}, ${args.resourceId},
       ${args.fromStatus}, ${args.toStatus}, ${args.note}, ${args.actorId})
  `);
}

export interface CaseStatusHistoryRow {
  id: string;
  fromStatus: string | null;
  toStatus: string;
  note: string | null;
  actorId: string;
  at: string;
}

/** Read the ordered timeline (oldest first) for one resource. */
export async function listStatusHistory(
  tenantId: string,
  resourceType: CaseResourceType,
  resourceId: string,
): Promise<CaseStatusHistoryRow[]> {
  return (await scopedRead((tx) =>
    tx.execute(sql`
      SELECT id,
             from_status AS "fromStatus",
             to_status   AS "toStatus",
             note,
             actor_id    AS "actorId",
             at
      FROM crm.case_status_history
      WHERE tenant_id = ${tenantId}
        AND resource_type = ${resourceType}
        AND resource_id = ${resourceId}
      ORDER BY at ASC, id ASC
    `),
  )) as unknown as CaseStatusHistoryRow[];
}
