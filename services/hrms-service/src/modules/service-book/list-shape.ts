/**
 * The service-book LIST row shape consumed by the web page
 * (apps/web .../hr/service-book -> ServiceBookView): eventType / detail /
 * status ("attested" | "recorded") / orderNo -- NOT the raw table columns
 * (entryType / description / attested / documentRef).
 *
 * GAP-HR-SERVICE-BOOK-06: the self-service GET /v1/hrms/service-book/me route
 * used to return the raw table rows while the HR list route
 * (lifecycle/m7-list-routes.ts GET /v1/hrms/service-book) mapped them to this
 * shape, so an employee's own page received rows with no eventType/status at
 * all (the attested status was invisible and the view crashed on the missing
 * eventType). Both routes now go through this one mapper so they cannot drift.
 *
 * Internal columns (recordedBy, attestedBy, attestRemarks, timestamps) are
 * deliberately not part of this shape.
 */
import type { ServiceBookRow } from "./schema.js";

export interface ServiceBookListEntry {
  id: string;
  employeeId: string;
  employee: string;
  eventType: string;
  detail: string;
  effectiveDate: string;
  orderNo: string;
  status: "attested" | "recorded";
}

export function toServiceBookListEntry(row: ServiceBookRow, employeeName: string): ServiceBookListEntry {
  return {
    id: row.id,
    employeeId: row.employeeId,
    employee: employeeName,
    eventType: row.entryType,
    detail: row.description,
    effectiveDate: row.effectiveDate,
    orderNo: row.documentRef ?? "—",
    status: row.attested ? "attested" : "recorded",
  };
}
