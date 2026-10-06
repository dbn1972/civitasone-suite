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
    // GAP-FIELD-{AGENTS,ROUTES,SYNC,TASKS}-0x (UUID theme): a code/currency is
    // plain text, but updatedAt/createdAt are ISO timestamps that must be
    // date-formatted at render rather than printed verbatim. Track which kind
    // of value `meta` holds so ModuleListTable can format a date.
    const metaText = toText(row.code) ?? toText(row.currency);
    const metaDate = toText(row.updatedAt) ?? toText(row.createdAt);
    const metaPoints =
      typeof row.points === "number" ? `${row.points} pts` : typeof row.balance === "number" ? `bal ${row.balance}` : undefined;
    const meta = metaText ?? metaDate ?? metaPoints;
    const metaKind: "date" | "text" | undefined = metaText ? "text" : metaDate ? "date" : undefined;
    mapped.push({
      id,
      label,
      ...(sublabel ? { sublabel } : {}),
      ...(status ? { status } : {}),
      ...(meta ? { meta } : {}),
      ...(meta && metaKind ? { metaKind } : {}),
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

/**
 * GAP-FIELD-SYNC-01: the pull used to hard-code since=1970-01-01 (every change
 * ever recorded, unbounded) with no explicit limit. Pull only a recent window
 * (default 7 days) at request time with an explicit page size, so the sync
 * list loads quickly against a large history. The service caps limit at 500.
 */
export const FIELD_SYNC_WINDOW_DAYS = 7;
export const FIELD_SYNC_LIMIT = 100;

export function fieldSyncPullPath(now: Date = new Date()): string {
  const since = new Date(now.getTime() - FIELD_SYNC_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
  return `/api/v1/field/sync/pull?since=${encodeURIComponent(since)}&limit=${FIELD_SYNC_LIMIT}`;
}

export const getFieldSync = (): Promise<LoaderResult<ModuleRowSummary[]>> =>
  fetchJson<unknown, ModuleRowSummary[]>(fieldSyncPullPath(), [] as ModuleRowSummary[], {
    revalidateSeconds: 30,
    telemetryKey: "field.sync",
    mapResponse: mapRows,
  });


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

/**
 * GAP-FIELD-VISITS-04: the visits list is capped at this page size. The server
 * returns the true `meta.total`; the page surfaces both so the "Visits" KPI
 * can say "latest N" honestly instead of silently capping at the page size.
 */
export const FIELD_VISITS_LIMIT = 100;

export type FieldVisitsPage = {
  rows: FieldVisitRow[];
  /** Server-reported total across all visits (may exceed rows.length). */
  total: number;
  /** The page size requested (rows is capped at this). */
  limit: number;
};

/** Extract `meta.total` from the field-service list envelope, when present. */
function extractTotal(payload: unknown): number | null {
  if (isRecord(payload) && isRecord(payload.meta) && typeof payload.meta.total === "number") {
    return payload.meta.total;
  }
  return null;
}

/** Typed visits list for the P1-10 GPS / outcome screen. */
export async function getFieldVisitsDetailed(): Promise<LoaderResult<FieldVisitsPage>> {
  const empty: FieldVisitsPage = { rows: [], total: 0, limit: FIELD_VISITS_LIMIT };
  return fetchJson(`/api/v1/field/visits?limit=${FIELD_VISITS_LIMIT}`, empty, {
    revalidateSeconds: 30,
    telemetryKey: "field.visits.detailed",
    mapResponse: (payload: unknown): FieldVisitsPage => {
      if (isRecord(payload) && Array.isArray((payload as { data?: unknown }).data)) {
        const rows = (payload as { data: FieldVisitRow[] }).data;
        const total = extractTotal(payload) ?? rows.length;
        return { rows, total, limit: FIELD_VISITS_LIMIT };
      }
      return empty;
    },
  });
}

// ─── Typed Tasks (GAP-FIELD-TASKS-03 / TASKS-05) ────────────────────────────

export type FieldTaskRow = {
  id: string;
  title: string;
  taskType: string;
  /** Assignee id, or null when unassigned. */
  assignee: string;
  status: string;
  priority: number | null;
  dueDate: string | null;
};

export const FIELD_TASKS_LIMIT = 100;

export function mapTasks(payload: unknown): FieldTaskRow[] {
  const rows = extractRows(payload);
  const mapped: FieldTaskRow[] = [];
  for (const row of rows) {
    if (!isRecord(row)) continue;
    const id = toText(row.id);
    if (!id) continue;
    mapped.push({
      id,
      title: toText(row.title) ?? toText(row.taskType) ?? "Untitled task",
      taskType: toText(row.taskType) ?? "—",
      assignee: toText(row.assigneeId) ?? "Unassigned",
      status: toText(row.status) ?? "unassigned",
      priority: typeof row.priority === "number" ? row.priority : null,
      dueDate: toText(row.dueDate) ?? null,
    });
  }
  return mapped;
}

export async function getFieldTasksDetailed(): Promise<LoaderResult<FieldTaskRow[]>> {
  return fetchJson<unknown, FieldTaskRow[]>(`/api/v1/field/tasks?limit=${FIELD_TASKS_LIMIT}`, [] as FieldTaskRow[], {
    revalidateSeconds: 30,
    telemetryKey: "field.tasks.detailed",
    mapResponse: mapTasks,
  });
}

// ─── Typed Routes (GAP-FIELD-ROUTES-02 / ROUTES-04) ─────────────────────────

export type FieldRouteRow = {
  id: string;
  agent: string;
  routeDate: string | null;
  status: string;
  stopCount: number;
  distanceKm: string | null;
  durationMinutes: number | null;
};

export const FIELD_ROUTES_LIMIT = 100;

export function mapRoutesDetailed(payload: unknown): FieldRouteRow[] {
  const rows = extractRows(payload);
  const mapped: FieldRouteRow[] = [];
  for (const row of rows) {
    if (!isRecord(row)) continue;
    const id = toText(row.id);
    if (!id) continue;
    const stops = Array.isArray(row.waypoints) ? row.waypoints.length : 0;
    mapped.push({
      id,
      agent: toText(row.assigneeId) ?? "—",
      routeDate: toText(row.routeDate) ?? null,
      status: toText(row.status) ?? "draft",
      stopCount: stops,
      distanceKm: toText(row.totalDistanceKm) ?? null,
      durationMinutes: typeof row.estimatedDurationMinutes === "number" ? row.estimatedDurationMinutes : null,
    });
  }
  return mapped;
}

export async function getFieldRoutesDetailed(): Promise<LoaderResult<FieldRouteRow[]>> {
  return fetchJson<unknown, FieldRouteRow[]>(`/api/v1/field/routes?limit=${FIELD_ROUTES_LIMIT}`, [] as FieldRouteRow[], {
    revalidateSeconds: 30,
    telemetryKey: "field.routes.detailed",
    mapResponse: mapRoutesDetailed,
  });
}

// ─── Typed Agents (GAP-FIELD-AGENTS-01 / AGENTS-04) ─────────────────────────

export type FieldAgentRow = {
  agentId: string;
  taskCount: number;
};

export function mapAgentRows(payload: unknown): FieldAgentRow[] {
  const rows = extractRows(payload);
  const mapped: FieldAgentRow[] = [];
  for (const row of rows) {
    if (!isRecord(row)) continue;
    const agentId = toText(row.agentId) ?? toText(row.id);
    if (!agentId) continue;
    const count = typeof row.taskCount === "number" ? row.taskCount : Number(toText(row.taskCount) ?? "");
    mapped.push({ agentId, taskCount: Number.isFinite(count) ? count : 0 });
  }
  return mapped;
}

export async function getFieldAgentsDetailed(): Promise<LoaderResult<FieldAgentRow[]>> {
  return fetchJson<unknown, FieldAgentRow[]>("/api/v1/field/agents", [] as FieldAgentRow[], {
    revalidateSeconds: 30,
    telemetryKey: "field.agents.detailed",
    mapResponse: mapAgentRows,
  });
}
