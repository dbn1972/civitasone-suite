/**
 * Inspection hub loaders — Server Components only.
 * Uses shared fetchJson; never throws (source:"error" on failure).
 */
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";

function asRows(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) return payload as Record<string, unknown>[];
  if (payload && typeof payload === "object" && Array.isArray((payload as { data?: unknown }).data)) {
    return (payload as { data: Record<string, unknown>[] }).data;
  }
  return [];
}

export function getInspections(): Promise<LoaderResult<Record<string, unknown>[]>> {
  return fetchJson<unknown, Record<string, unknown>[]>("/api/v1/inspection/inspections?limit=50", [], {
    revalidateSeconds: 30,
    telemetryKey: "inspection.list",
    mapResponse: asRows,
  });
}

export function getInspectionAssignments(): Promise<LoaderResult<Record<string, unknown>[]>> {
  return fetchJson<unknown, Record<string, unknown>[]>("/api/v1/inspection/assignments?limit=50", [], {
    revalidateSeconds: 30,
    telemetryKey: "inspection.assignments",
    mapResponse: asRows,
  });
}

export function getInspectionCapas(): Promise<LoaderResult<Record<string, unknown>[]>> {
  return fetchJson<unknown, Record<string, unknown>[]>("/api/v1/inspection/capa?limit=50", [], {
    revalidateSeconds: 30,
    telemetryKey: "inspection.capa",
    mapResponse: asRows,
  });
}

export type { LoaderResult };
