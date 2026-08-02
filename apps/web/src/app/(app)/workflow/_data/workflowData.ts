import { cookies } from "next/headers";
import { COOKIE } from "@/lib/auth/config";
import type {
  WorkflowResult,
  WorkflowDefinition,
  WorkflowDefinitionDetail,
  WorkflowNode,
  WorkflowEdge,
  WorkflowInstance,
  WorkflowInstanceDetail,
  WorkflowTransition,
  WorkflowTask,
  WorkflowAnalytics,
} from "./workflowTypes";

/**
 * Workflow-module SERVER data layer (imports next/headers — server-only).
 *
 * Mirrors the suite's `_data/apiClient` pattern (gateway base URL from env +
 * Bearer token from the access cookie) but is scoped to the workflow route
 * folder so the BPM surface can fetch the richer shapes the shared
 * `getWorkflowInstances` loader (ModuleRowSummary[]) does not expose:
 * definitions (+ graph), instance history, tasks and analytics.
 *
 * API-only — no mock fallback. On any failure the loader returns empty data and
 * `source: "error"` so the page can surface the gap gracefully.
 */

// Re-export the client-safe types/helpers so callers can import either module.
export type {
  WorkflowSource,
  WorkflowResult,
  WorkflowDefinition,
  WorkflowDefinitionDetail,
  WorkflowNode,
  WorkflowEdge,
  WorkflowInstance,
  WorkflowInstanceDetail,
  WorkflowTransition,
  WorkflowTask,
  WorkflowAnalytics,
} from "./workflowTypes";
export { formatDuration, titleCase } from "./workflowTypes";

function gatewayBaseUrl(): string | null {
  const base =
    process.env.CIVITASONE_API_BASE_URL ||
    process.env.NEXT_PUBLIC_API_BASE_URL ||
    null;
  return base && base.length > 0 ? base.replace(/\/$/, "") : null;
}

function authHeader(): Record<string, string> {
  const token = cookies().get(COOKIE.ACCESS)?.value;
  return token ? { authorization: `Bearer ${token}` } : {};
}

async function getJson<T>(
  path: string,
  empty: T,
  map: (raw: unknown) => T | null,
  revalidateSeconds = 20,
): Promise<WorkflowResult<T>> {
  const base = gatewayBaseUrl();
  if (!base) return { data: empty, source: "error" };
  const auth = authHeader();
  if (!auth.authorization) return { data: empty, source: "error", status: 401 };

  const apiPath = path.startsWith("/api/") ? path : `/api${path.startsWith("/") ? "" : "/"}${path}`;
  try {
    const res = await fetch(`${base}${apiPath}`, {
      headers: { "content-type": "application/json", ...auth },
      next: { revalidate: revalidateSeconds },
    });
    if (!res.ok) return { data: empty, source: "error", status: res.status };
    const raw = await res.json();
    const mapped = map(raw);
    if (mapped === null) return { data: empty, source: "error", status: res.status };
    return { data: mapped, source: "api" };
  } catch {
    return { data: empty, source: "error" };
  }
}

/* ── shape helpers ──────────────────────────────────────────────── */

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function str(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}
function optStr(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}
function num(v: unknown, d = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : d;
}
/** Unwrap the gateway's `{ data: ... }` envelope (or pass through a bare value). */
function unwrap(raw: unknown): unknown {
  if (isRecord(raw) && "data" in raw) return raw.data;
  return raw;
}

/* ── Definitions ────────────────────────────────────────────────── */

function mapDefinition(v: unknown): WorkflowDefinition | null {
  if (!isRecord(v)) return null;
  if (typeof v.id !== "string") return null;
  return {
    id: v.id,
    code: str(v.code),
    name: str(v.name),
    version: num(v.version, 1),
    status: str(v.status) || "draft",
    description: optStr(v.description),
    isTemplate: v.isTemplate === true,
  };
}

export async function getDefinitions(): Promise<WorkflowResult<WorkflowDefinition[]>> {
  return getJson<WorkflowDefinition[]>(
    "/v1/workflow/definitions?limit=200",
    [],
    (raw) => {
      const arr = unwrap(raw);
      if (!Array.isArray(arr)) return null;
      return arr.map(mapDefinition).filter((d): d is WorkflowDefinition => d !== null);
    },
    30,
  );
}

export async function getDefinitionById(
  id: string,
): Promise<WorkflowResult<WorkflowDefinitionDetail | null>> {
  return getJson<WorkflowDefinitionDetail | null>(
    `/v1/workflow/definitions/${id}`,
    null,
    (raw) => {
      const v = unwrap(raw);
      const base = mapDefinition(v);
      if (!base || !isRecord(v)) return null;
      const nodes = Array.isArray(v.nodes)
        ? v.nodes.filter(isRecord).map((n): WorkflowNode => ({
            nodeKey: str(n.nodeKey),
            name: str(n.name) || str(n.nodeKey),
            nodeType: str(n.nodeType) || "task",
            roleRef: optStr(n.roleRef),
            slaMinutes: typeof n.slaMinutes === "number" ? n.slaMinutes : null,
            assignStrategy: optStr(n.assignStrategy),
            sortOrder: typeof n.sortOrder === "number" ? n.sortOrder : null,
          }))
        : [];
      const edges = Array.isArray(v.edges)
        ? v.edges.filter(isRecord).map((e): WorkflowEdge => ({
            fromNode: str(e.fromNode),
            toNode: str(e.toNode),
            condition: optStr(e.condition),
            sortOrder: typeof e.sortOrder === "number" ? e.sortOrder : null,
          }))
        : [];
      return { ...base, nodes, edges };
    },
    30,
  );
}

/* ── Instances ──────────────────────────────────────────────────── */

function mapInstance(v: unknown): WorkflowInstance | null {
  if (!isRecord(v) || typeof v.id !== "string") return null;
  return {
    id: v.id,
    name: str(v.name) || v.id,
    status: str(v.status) || "active",
    version: num(v.version, 1),
  };
}

export async function getInstances(): Promise<WorkflowResult<WorkflowInstance[]>> {
  return getJson<WorkflowInstance[]>(
    "/v1/workflow/instances?limit=200",
    [],
    (raw) => {
      const arr = unwrap(raw);
      if (!Array.isArray(arr)) return null;
      return arr.map(mapInstance).filter((i): i is WorkflowInstance => i !== null);
    },
    20,
  );
}

function mapInstanceDetail(v: unknown): WorkflowInstanceDetail | null {
  if (!isRecord(v) || typeof v.id !== "string") return null;
  return {
    id: v.id,
    name: str(v.name) || v.id,
    status: str(v.status) || "active",
    version: num(v.version, 1),
    definitionId: optStr(v.definitionId),
    definitionCode: optStr(v.definitionCode),
    definitionName: optStr(v.definitionName),
    refType: optStr(v.refType),
    refId: optStr(v.refId),
    currentNode: optStr(v.currentNode),
    createdAt: optStr(v.createdAt),
    updatedAt: optStr(v.updatedAt),
  };
}

/**
 * D1 (FE↔BE high ROI) — dedicated GET by id. Previously the service had no
 * GET /instances/:id, so this fetched the ENTIRE tenant instance list and
 * filtered client-side. Mirrors getDefinitionById's shape (a 404 surfaces as
 * `source: "error"`, same as every other detail loader in this module).
 */
export async function getInstanceById(
  id: string,
): Promise<WorkflowResult<WorkflowInstanceDetail | null>> {
  return getJson<WorkflowInstanceDetail | null>(
    `/v1/workflow/instances/${id}`,
    null,
    (raw) => mapInstanceDetail(unwrap(raw)),
    20,
  );
}

/* ── Transition history ─────────────────────────────────────────── */

export async function getInstanceHistory(
  id: string,
): Promise<WorkflowResult<WorkflowTransition[]>> {
  return getJson<WorkflowTransition[]>(
    `/v1/workflow/instances/${id}/history`,
    [],
    (raw) => {
      const arr = unwrap(raw);
      if (!Array.isArray(arr)) return null;
      return arr.filter(isRecord).map((t): WorkflowTransition => ({
        id: str(t.id),
        fromNode: optStr(t.fromNode),
        toNode: optStr(t.toNode),
        action: str(t.action),
        decision: optStr(t.decision),
        actorId: str(t.actorId),
        createdAt: str(t.createdAt),
        ...(isRecord(t.detail) ? { detail: t.detail } : {}),
      }));
    },
    10,
  );
}

/* ── Tasks ──────────────────────────────────────────────────────── */

function mapTask(v: unknown): WorkflowTask | null {
  if (!isRecord(v) || typeof v.id !== "string") return null;
  return {
    id: v.id,
    instanceId: str(v.instanceId),
    name: str(v.name) || "Task",
    status: str(v.status) || "pending",
    roleRef: optStr(v.roleRef),
    nodeKey: optStr(v.nodeKey),
    refType: optStr(v.refType),
    refId: optStr(v.refId),
    decision: optStr(v.decision),
    assigneeId: optStr(v.assigneeId),
    version: num(v.version, 1),
  };
}

/**
 * Task inbox. `status=pending` returns role-targeted pending tasks for the
 * caller (the service scopes to ctx.roles); omit `status` for all tenant tasks.
 */
export async function getTasks(
  opts: { status?: string } = {},
): Promise<WorkflowResult<WorkflowTask[]>> {
  const qs = new URLSearchParams({ limit: "200" });
  if (opts.status) qs.set("status", opts.status);
  return getJson<WorkflowTask[]>(
    `/v1/workflow/tasks?${qs.toString()}`,
    [],
    (raw) => {
      const arr = unwrap(raw);
      if (!Array.isArray(arr)) return null;
      return arr.map(mapTask).filter((t): t is WorkflowTask => t !== null);
    },
    10,
  );
}

/**
 * D1 (FE↔BE high ROI) — tasks for a single instance via the server-side
 * `instanceId` filter. Previously fetched the ENTIRE tenant task list and
 * filtered client-side.
 */
export async function getTasksForInstance(
  instanceId: string,
): Promise<WorkflowResult<WorkflowTask[]>> {
  return getJson<WorkflowTask[]>(
    `/v1/workflow/tasks?instanceId=${instanceId}&limit=200`,
    [],
    (raw) => {
      const arr = unwrap(raw);
      if (!Array.isArray(arr)) return null;
      return arr.map(mapTask).filter((t): t is WorkflowTask => t !== null);
    },
    10,
  );
}

/* ── Analytics ──────────────────────────────────────────────────── */

const EMPTY_ANALYTICS: WorkflowAnalytics = {
  instancesByStatus: {},
  totalInstances: 0,
  avgCycleTimeSeconds: null,
  completedCount: 0,
  slaBreachRate: 0,
  slaBreachedTasks: 0,
  slaTrackedTasks: 0,
  escalations: 0,
};

export async function getAnalyticsSummary(): Promise<WorkflowResult<WorkflowAnalytics>> {
  return getJson<WorkflowAnalytics>(
    "/v1/workflow/analytics/summary",
    EMPTY_ANALYTICS,
    (raw) => {
      const v = unwrap(raw);
      if (!isRecord(v)) return null;
      const byStatus: Record<string, number> = {};
      if (isRecord(v.instancesByStatus)) {
        for (const [k, n] of Object.entries(v.instancesByStatus)) byStatus[k] = num(n);
      }
      return {
        instancesByStatus: byStatus,
        totalInstances: num(v.totalInstances),
        avgCycleTimeSeconds: typeof v.avgCycleTimeSeconds === "number" ? v.avgCycleTimeSeconds : null,
        completedCount: num(v.completedCount),
        slaBreachRate: num(v.slaBreachRate),
        slaBreachedTasks: num(v.slaBreachedTasks),
        slaTrackedTasks: num(v.slaTrackedTasks),
        escalations: num(v.escalations),
      };
    },
    30,
  );
}
