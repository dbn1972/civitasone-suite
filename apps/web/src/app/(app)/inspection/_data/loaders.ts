/**
 * Inspection hub loaders — Server Components only.
 * Uses shared fetchJson; never throws (source:"error" on failure).
 */
import { z } from "zod";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";

function asRows(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) return payload as Record<string, unknown>[];
  if (payload && typeof payload === "object" && Array.isArray((payload as { data?: unknown }).data)) {
    return (payload as { data: Record<string, unknown>[] }).data;
  }
  return [];
}

/**
 * GAP-INSPECTION-HOME-02 / INSPECTIONS-05: the list endpoints return the
 * envelope `{ data, meta: { page, pageSize, total } }` (every list repo in
 * services/inspection-service returns `PaginatedResult<T>`). `asRows` keeps
 * only the array and discards `meta.total`, so a stat card built from
 * `data.length` silently caps at the requested pageSize. `readTotal` reads the
 * real total when the service sends it; `null` when it did not (an older
 * payload or a bare array), so the caller can fall back to "N+".
 */
function readTotal(payload: unknown): number | null {
  if (
    payload &&
    typeof payload === "object" &&
    "meta" in payload &&
    (payload as { meta?: unknown }).meta &&
    typeof (payload as { meta: unknown }).meta === "object"
  ) {
    const total = (payload as { meta: { total?: unknown } }).meta.total;
    if (typeof total === "number" && Number.isFinite(total)) return total;
  }
  return null;
}

/** A list result that also carries the server's reported `total`, when known. */
export type ListResult = { rows: Record<string, unknown>[]; total: number | null };

function asListResult(payload: unknown): ListResult {
  return { rows: asRows(payload), total: readTotal(payload) };
}

/**
 * GAP-INSPECTION-INSPECTIONS-01 / 03: typed row for an execution.inspections
 * record. The status column is `state` (not `status`) — see
 * services/inspection-service/src/modules/execution/schema.ts. Every field is
 * optional/passthrough so a service that has not yet rolled out a column keeps
 * the list readable rather than blanking it (apiClient's responseSchema is
 * applied to the array elements only via mapResponse, below).
 */
export const InspectionListItemSchema = z
  .object({
    id: z.string(),
    state: z.string().optional(),
    entityId: z.string().optional(),
    inspectionTypeId: z.string().optional(),
    reviewerId: z.string().nullish(),
    scheduledDate: z.string().nullish(),
    createdAt: z.string().optional(),
  })
  .passthrough();
export type InspectionListItem = z.infer<typeof InspectionListItemSchema>;

/**
 * GAP-INSPECTION-ASSIGNMENTS-04: typed row for an assignment.inspection_assignments
 * record (schema.ts): inspectorId, scheduledDate, status, entityId,
 * inspectionTypeId, inspectionId.
 */
export const AssignmentListItemSchema = z
  .object({
    id: z.string(),
    inspectionId: z.string().optional(),
    inspectorId: z.string().optional(),
    inspectionTypeId: z.string().optional(),
    entityId: z.string().optional(),
    scheduledDate: z.string().nullish(),
    status: z.string().optional(),
  })
  .passthrough();
export type AssignmentListItem = z.infer<typeof AssignmentListItemSchema>;

/**
 * GAP-INSPECTION-CAPA-05: typed row for a capa.corrective_actions record
 * (schema.ts): description, status, dueDate, ownerId, type, findingId.
 */
export const CapaListItemSchema = z
  .object({
    id: z.string(),
    description: z.string().optional(),
    status: z.string().optional(),
    dueDate: z.string().nullish(),
    ownerId: z.string().nullish(),
    type: z.string().optional(),
    findingId: z.string().optional(),
  })
  .passthrough();
export type CapaListItem = z.infer<typeof CapaListItemSchema>;

export function getInspections(): Promise<LoaderResult<Record<string, unknown>[]>> {
  return fetchJson<unknown, Record<string, unknown>[]>("/api/v1/inspection/inspections?pageSize=50", [], {
    revalidateSeconds: 30,
    telemetryKey: "inspection.list",
    mapResponse: asRows,
  });
}

export function getInspectionAssignments(): Promise<LoaderResult<Record<string, unknown>[]>> {
  return fetchJson<unknown, Record<string, unknown>[]>("/api/v1/inspection/assignments?pageSize=50", [], {
    revalidateSeconds: 30,
    telemetryKey: "inspection.assignments",
    mapResponse: asRows,
  });
}

export function getInspectionCapas(): Promise<LoaderResult<Record<string, unknown>[]>> {
  return fetchJson<unknown, Record<string, unknown>[]>("/api/v1/inspection/capa?pageSize=50", [], {
    revalidateSeconds: 30,
    telemetryKey: "inspection.capa",
    mapResponse: asRows,
  });
}

/**
 * GAP-INSPECTION-HOME-02: list loaders that preserve the server's `meta.total`
 * so a stat card can show the true count instead of a page-capped length.
 * Separate from the array loaders above so existing callers are unaffected.
 */
export function getInspectionsList(): Promise<LoaderResult<ListResult>> {
  return fetchJson<unknown, ListResult>(
    "/api/v1/inspection/inspections?pageSize=50",
    { rows: [], total: null },
    { revalidateSeconds: 30, telemetryKey: "inspection.list", mapResponse: asListResult },
  );
}

export function getInspectionAssignmentsList(): Promise<LoaderResult<ListResult>> {
  return fetchJson<unknown, ListResult>(
    "/api/v1/inspection/assignments?pageSize=50",
    { rows: [], total: null },
    { revalidateSeconds: 30, telemetryKey: "inspection.assignments", mapResponse: asListResult },
  );
}

export function getInspectionCapasList(): Promise<LoaderResult<ListResult>> {
  return fetchJson<unknown, ListResult>(
    "/api/v1/inspection/capa?pageSize=50",
    { rows: [], total: null },
    { revalidateSeconds: 30, telemetryKey: "inspection.capa", mapResponse: asListResult },
  );
}

/**
 * GAP-INSPECTION-INSPECTIONS-05: server-side paginated inspections list. The
 * execution list route accepts `page` and `pageSize` (max 200) and returns the
 * `{ data, meta:{ page, pageSize, total } }` envelope (services/inspection-
 * service/.../execution/routes.ts), so the page can request one page at a time
 * instead of fetching a capped 50 and showing no pager. `page`/`pageSize` are
 * clamped here so a hand-edited URL can never send an out-of-range query.
 */
export const INSPECTIONS_PAGE_SIZE = 20;

export function getInspectionsPage(page: number): Promise<LoaderResult<ListResult>> {
  const safePage = Number.isFinite(page) && page >= 1 ? Math.floor(page) : 1;
  return fetchJson<unknown, ListResult>(
    `/api/v1/inspection/inspections?page=${safePage}&pageSize=${INSPECTIONS_PAGE_SIZE}`,
    { rows: [], total: null },
    { revalidateSeconds: 30, telemetryKey: "inspection.list", mapResponse: asListResult },
  );
}

export type { LoaderResult };
