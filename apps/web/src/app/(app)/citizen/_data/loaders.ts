/**
 * citizen feature — server-side loaders (Server Components only).
 *
 * Follows the app convention (see src/app/_data/apiClient.ts): every loader
 * returns LoaderResult<T> = { data, source } and never throws. Gateway
 * rewrites the "/api/v1/citizen" prefix to the citizen-service base
 * "/v1/citizen".
 */
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";

function asObj(x: unknown): Record<string, unknown> | null {
  return x && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>) : null;
}
function asArray(x: unknown): Record<string, unknown>[] {
  return Array.isArray(x) ? (x as Record<string, unknown>[]) : [];
}
function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : v == null ? fallback : String(v);
}
function strOrNull(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

export interface GrievanceAction {
  id: string;
  actionType: string;
  note?: string | null;
  createdAt: string;
}

export interface Grievance {
  id: string;
  category: string;
  subject: string;
  description: string;
  priority: string;
  status: string;
  departmentRef?: string | null;
  assignedTo?: string | null;
  createdAt: string;
  updatedAt: string;
  actions: GrievanceAction[];
}

function toGrievanceAction(r: Record<string, unknown>): GrievanceAction {
  return {
    id: str(r.id),
    actionType: str(r.actionType),
    note: strOrNull(r.note),
    createdAt: str(r.createdAt),
  };
}

function toGrievance(r: Record<string, unknown>): Grievance {
  return {
    id: str(r.id),
    category: str(r.category),
    subject: str(r.subject),
    description: str(r.description),
    priority: str(r.priority),
    status: str(r.status),
    departmentRef: strOrNull(r.departmentRef),
    assignedTo: strOrNull(r.assignedTo),
    createdAt: str(r.createdAt),
    updatedAt: str(r.updatedAt),
    actions: asArray(r.actions).map(toGrievanceAction),
  };
}

/**
 * PERF-009 tranche 2: fetches the grievance server-side during SSR instead of
 * shipping the page empty and having the client re-fetch after hydration (a
 * client-fetch "waterfall hop" on every navigation into this route).
 * RequestDetailClient still keeps its own client-side `load()` — used to
 * refresh after a mutation, and as a same-as-before fallback on first mount
 * when this loader's `source` comes back "error" (no base URL / unauthenticated
 * / network failure / bad shape), so resilience is unchanged from before this
 * loader existed.
 */
export function getGrievanceDetail(id: string): Promise<LoaderResult<Grievance | null>> {
  return fetchJson<unknown, Grievance | null>(`/api/v1/citizen/grievances/${id}`, null, {
    telemetryKey: "citizen.grievance.detail",
    mapResponse: (payload) => {
      const r = asObj(payload);
      if (!r || !r.id) return null;
      return toGrievance(r);
    },
  });
}
