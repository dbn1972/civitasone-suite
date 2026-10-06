/**
 * journey route-group server loaders.
 *
 * GAP-JOURNEYS-ACTIVE-01/02, ANALYTICS-01/02, BUILDER-02, TEMPLATES-02:
 * the generic key-guessing `mapRows` is replaced with typed mappers, one per
 * journey-service endpoint, so each list page shows columns that actually mean
 * the same thing for every row (journey name vs raw id, a styled status, a
 * formatted date) instead of whichever of ~10 candidate keys happened to exist.
 *
 * The journey-service response shape is `{ data: Row[], meta: { page, pageSize,
 * total } }` for every list endpoint (see each module's routes.ts in
 * services/journey-service), so the mappers read `payload.data` and the typed
 * row views each endpoint's repo.toView() produces.
 */
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toText(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return undefined;
}

function toInt(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** Pull the `data` array out of the `{ data, meta }` envelope, tolerating a
 * bare array or a service that has not been rolled out yet. */
function extractData(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (isRecord(payload) && Array.isArray(payload.data)) return payload.data as unknown[];
  return [];
}

function extractTotal(payload: unknown, fallbackLength: number): number {
  if (isRecord(payload) && isRecord(payload.meta)) {
    const total = toInt(payload.meta.total);
    if (total !== undefined) return total;
  }
  return fallbackLength;
}

// ── Journey definitions (GET /api/v1/journeys) ──────────────────────────────

export type JourneyDefinitionRow = {
  id: string;
  name: string;
  status: string;
  stepCount: number;
  updatedAt: string | null;
}

function mapJourneys(payload: unknown): JourneyDefinitionRow[] {
  const out: JourneyDefinitionRow[] = [];
  for (const row of extractData(payload)) {
    if (!isRecord(row)) continue;
    const id = toText(row.id);
    if (!id) continue;
    out.push({
      id,
      name: toText(row.name) ?? id,
      status: toText(row.status) ?? "unknown",
      stepCount: Array.isArray(row.steps) ? row.steps.length : 0,
      updatedAt: toText(row.updatedAt) ?? null,
    });
  }
  return out;
}

// ── Executions (GET /api/v1/journeys/executions) ────────────────────────────

export type JourneyExecutionRow = {
  id: string;
  journeyId: string | null;
  profileId: string | null;
  status: string;
  currentStepIndex: number | null;
  enrolledAt: string | null;
  completedAt: string | null;
}

function mapExecutions(payload: unknown): JourneyExecutionRow[] {
  const out: JourneyExecutionRow[] = [];
  for (const row of extractData(payload)) {
    if (!isRecord(row)) continue;
    const id = toText(row.id);
    if (!id) continue;
    out.push({
      id,
      journeyId: toText(row.journeyId) ?? null,
      profileId: toText(row.profileId) ?? null,
      status: toText(row.status) ?? "unknown",
      currentStepIndex: toInt(row.currentStepIndex) ?? null,
      enrolledAt: toText(row.enrolledAt) ?? null,
      completedAt: toText(row.completedAt) ?? null,
    });
  }
  return out;
}

// ── Triggers / templates (GET /api/v1/journeys/triggers) ────────────────────

export type JourneyTriggerRow = {
  id: string;
  journeyId: string | null;
  triggerType: string;
  status: string;
  updatedAt: string | null;
}

function mapTriggers(payload: unknown): JourneyTriggerRow[] {
  const out: JourneyTriggerRow[] = [];
  for (const row of extractData(payload)) {
    if (!isRecord(row)) continue;
    const id = toText(row.id);
    if (!id) continue;
    out.push({
      id,
      journeyId: toText(row.journeyId) ?? null,
      triggerType: toText(row.triggerType) ?? "unknown",
      status: toText(row.status) ?? "unknown",
      updatedAt: toText(row.updatedAt) ?? null,
    });
  }
  return out;
}

// ── Analytics (derived from executions) ─────────────────────────────────────

export interface JourneyAnalytics {
  total: number;
  running: number;
  completed: number;
  failed: number;
  byStatus: Array<{ status: string; count: number }>;
}

const RUNNING_STATUSES = new Set(["enrolled", "in_progress", "active", "running"]);
const COMPLETED_STATUSES = new Set(["completed", "converted"]);
const FAILED_STATUSES = new Set(["failed", "exited", "errored", "cancelled"]);

/**
 * GAP-JOURNEYS-ANALYTICS-01: compute funnel counts client-side from the
 * executions list (decision: no dedicated analytics endpoint exists in
 * journey-service, so derive honest counts from the one list we have). `total`
 * is the server-reported total so the headline count is not understated by the
 * default page size; the per-status breakdown is over the rows actually
 * returned and is labelled as such in the UI.
 */
function mapAnalytics(payload: unknown): JourneyAnalytics {
  const rows = mapExecutions(payload);
  const counts = new Map<string, number>();
  let running = 0;
  let completed = 0;
  let failed = 0;
  for (const r of rows) {
    counts.set(r.status, (counts.get(r.status) ?? 0) + 1);
    if (RUNNING_STATUSES.has(r.status)) running += 1;
    else if (COMPLETED_STATUSES.has(r.status)) completed += 1;
    else if (FAILED_STATUSES.has(r.status)) failed += 1;
  }
  return {
    total: extractTotal(payload, rows.length),
    running,
    completed,
    failed,
    byStatus: [...counts.entries()]
      .map(([status, count]) => ({ status, count }))
      .sort((a, b) => b.count - a.count),
  };
}

// ── Count-aware loaders for the hub (GAP-JOURNEYS-HOME-02) ───────────────────

export interface JourneyCounts {
  defined: number | null;
  running: number | null;
}

function mapJourneyCount(payload: unknown): number {
  return extractTotal(payload, mapJourneys(payload).length);
}

// Server-side total for a status-filtered executions query. The list route
// defaults to limit=20, so counting rows client-side would understate the
// figure once there are more executions than one page; meta.total is exact.
function mapStatusTotal(payload: unknown): number {
  return extractTotal(payload, mapExecutions(payload).length);
}

// journey-service filters by exact status; "running" spans these two states.
const RUNNING_FILTER_STATUSES = ["enrolled", "in_progress"] as const;

function fetchStatusTotal(status: string, telemetryKey: string): Promise<LoaderResult<number>> {
  return fetchJson<unknown, number>(
    `/api/v1/journeys/executions?status=${encodeURIComponent(status)}&limit=1`,
    0,
    { revalidateSeconds: 30, telemetryKey, mapResponse: mapStatusTotal },
  );
}

async function fetchRunningTotal(keyPrefix: string): Promise<number | null> {
  const parts = await Promise.all(
    RUNNING_FILTER_STATUSES.map((st) => fetchStatusTotal(st, `${keyPrefix}.${st}`)),
  );
  if (parts.some((p) => p.source === "error")) return null;
  return parts.reduce((sum, p) => sum + p.data, 0);
}

// ── Loaders ──────────────────────────────────────────────────────────────────

export function getJourneyBuilder(): Promise<LoaderResult<JourneyDefinitionRow[]>> {
  return fetchJson<unknown, JourneyDefinitionRow[]>("/api/v1/journeys", [], {
    revalidateSeconds: 30,
    telemetryKey: "journeys.builder",
    mapResponse: mapJourneys,
  });
}

export function getJourneyActive(): Promise<LoaderResult<JourneyExecutionRow[]>> {
  return fetchJson<unknown, JourneyExecutionRow[]>("/api/v1/journeys/executions", [], {
    revalidateSeconds: 30,
    telemetryKey: "journeys.active",
    mapResponse: mapExecutions,
  });
}

export function getJourneyTemplates(): Promise<LoaderResult<JourneyTriggerRow[]>> {
  return fetchJson<unknown, JourneyTriggerRow[]>("/api/v1/journeys/triggers", [], {
    revalidateSeconds: 30,
    telemetryKey: "journeys.templates",
    mapResponse: mapTriggers,
  });
}

export async function getJourneyAnalytics(): Promise<LoaderResult<JourneyAnalytics>> {
  // The list (max page) feeds the per-status breakdown; the headline running /
  // completed / failed figures use server-side totals so they are not capped
  // by the page size.
  const [list, running, completed, exited] = await Promise.all([
    fetchJson<unknown, JourneyAnalytics>(
      "/api/v1/journeys/executions?limit=200",
      { total: 0, running: 0, completed: 0, failed: 0, byStatus: [] },
      { revalidateSeconds: 30, telemetryKey: "journeys.analytics", mapResponse: mapAnalytics },
    ),
    fetchRunningTotal("journeys.analytics.running"),
    fetchStatusTotal("completed", "journeys.analytics.completed"),
    fetchStatusTotal("exited", "journeys.analytics.exited"),
  ]);
  if (list.source === "error") return list;
  return {
    ...list,
    data: {
      ...list.data,
      running: running ?? list.data.running,
      completed: completed.source === "error" ? list.data.completed : completed.data,
      failed: exited.source === "error" ? list.data.failed : exited.data,
    },
  };
}

export async function getJourneyCounts(): Promise<JourneyCounts> {
  const [defined, running] = await Promise.all([
    fetchJson<unknown, number>("/api/v1/journeys", 0, {
      revalidateSeconds: 30,
      telemetryKey: "journeys.count.defined",
      mapResponse: mapJourneyCount,
    }),
    fetchRunningTotal("journeys.count.running"),
  ]);
  return {
    defined: defined.source === "error" ? null : defined.data,
    running,
  };
}

// Internal mappers exported for unit tests only.
export const __test = { mapJourneys, mapExecutions, mapTriggers, mapAnalytics, mapStatusTotal };
