/**
 * field route-group server loaders — SCORE_LOCK F1 child pages.
 * Calls field-service through the gateway via cookie-aware fetchJson.
 */
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import type { ModuleRowSummary } from "@civitasone/types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toText(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return undefined;
}

function extractRows(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!isRecord(payload)) return [];
  for (const key of ["data", "items", "resources", "rows", "results", "nodes", "changes", "breakers"]) {
    if (Array.isArray(payload[key])) return payload[key] as unknown[];
  }
  if (isRecord(payload.data)) return [payload.data];
  return [payload];
}

function mapRows(payload: unknown): ModuleRowSummary[] {
  const mapped: ModuleRowSummary[] = [];
  for (const [index, row] of extractRows(payload).entries()) {
    if (!isRecord(row)) continue;
    const id =
      toText(row.id) ??
      toText(row.key) ??
      toText(row.code) ??
      toText(row.name) ??
      toText(row.agentId) ??
      toText(row.profileId) ??
      toText(row.accountId) ??
      toText(row.conversationId) ??
      `row-${index + 1}`;
    const label =
      toText(row.name) ??
      toText(row.title) ??
      toText(row.label) ??
      toText(row.code) ??
      toText(row.type) ??
      toText(row.entityType) ??
      toText(row.direction) ??
      id;
    const sublabel =
      toText(row.description) ??
      toText(row.status) ??
      toText(row.state) ??
      toText(row.category) ??
      toText(row.tier) ??
      toText(row.programName) ??
      toText(row.agentId) ??
      toText(row.profileId);
    const status = toText(row.status) ?? toText(row.state) ?? toText(row.lifecycle);
    const meta =
      toText(row.code) ??
      toText(row.currency) ??
      toText(row.updatedAt) ??
      toText(row.createdAt) ??
      (typeof row.points === "number" ? `${row.points} pts` : undefined) ??
      (typeof row.balance === "number" ? `bal ${row.balance}` : undefined);
    mapped.push({
      id,
      label,
      ...(sublabel ? { sublabel } : {}),
      ...(status ? { status } : {}),
      ...(meta ? { meta } : {}),
    });
  }
  return mapped;
}

function moduleLoader(path: string, key: string) {
  return (): Promise<LoaderResult<ModuleRowSummary[]>> =>
    fetchJson<unknown, ModuleRowSummary[]>(path, [] as ModuleRowSummary[], {
      revalidateSeconds: 30,
      telemetryKey: key,
      mapResponse: mapRows,
    });
}

export const getFieldTasks = moduleLoader("/api/v1/field/tasks", "field.tasks");
export const getFieldRoutes = moduleLoader("/api/v1/field/routes", "field.routes");
export const getFieldVisits = moduleLoader("/api/v1/field/visits?limit=100", "field.visits");
export const getFieldAgents = moduleLoader("/api/v1/field/tasks", "field.agents");
export const getFieldSync = moduleLoader("/api/v1/field/sync/pull?since=1970-01-01T00:00:00.000Z", "field.sync");


export type FieldVisitRow = {
  id: string;
  taskId: string;
  agentId: string;
  checkInLatitude: string | null;
  checkInLongitude: string | null;
  checkOutLatitude: string | null;
  checkOutLongitude: string | null;
  checkInAt: string | null;
  checkOutAt: string | null;
  durationMinutes: number | null;
  outcome: string | null;
  notes: string | null;
};

/** Typed visits list for the P1-10 GPS / outcome screen. */
export async function getFieldVisitsDetailed(): Promise<LoaderResult<FieldVisitRow[]>> {
  return fetchJson("/api/v1/field/visits?limit=100", [] as FieldVisitRow[], {
    revalidateSeconds: 30,
    telemetryKey: "field.visits.detailed",
    mapResponse: (payload: unknown) => {
      if (typeof payload === "object" && payload !== null && Array.isArray((payload as { data?: unknown }).data)) {
        return (payload as { data: FieldVisitRow[] }).data;
      }
      return [];
    },
  });
}
