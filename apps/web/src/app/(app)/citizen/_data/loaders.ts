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
/** Matches the `court`/`knowledge` loaders' own `bool()` convention exactly. */
function bool(v: unknown): boolean {
  return v === true;
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

/** RTI response document (GET /v1/citizen/rti/:id → .responses[]). */
export interface RtiResponse {
  id: string;
  responseUrl: string;
  respondedAt: string;
}

/** RTI appeal (§19/§20 of the Act) (GET /v1/citizen/rti/:id → .appeals[]). */
export interface RtiAppeal {
  id: string;
  appealType: string;
  grounds: string;
  status: string;
  createdAt: string;
}

/** Shape returned by GET /v1/citizen/rti/:id. */
export interface RtiDetail {
  id: string;
  rtiNo: string;
  subject: string;
  description: string;
  cpioRef: string;
  deadline: string;
  status: string;
  statusLabel: string;
  isOverdue: boolean;
  createdAt: string;
  updatedAt: string;
  responses: RtiResponse[];
  appeals: RtiAppeal[];
}

function toRtiResponse(r: Record<string, unknown>): RtiResponse {
  return {
    id: str(r.id),
    responseUrl: str(r.responseUrl),
    respondedAt: str(r.respondedAt),
  };
}

function toRtiAppeal(r: Record<string, unknown>): RtiAppeal {
  return {
    id: str(r.id),
    appealType: str(r.appealType),
    grounds: str(r.grounds),
    status: str(r.status),
    createdAt: str(r.createdAt),
  };
}

function toRtiDetail(r: Record<string, unknown>): RtiDetail {
  return {
    id: str(r.id),
    rtiNo: str(r.rtiNo),
    subject: str(r.subject),
    description: str(r.description),
    cpioRef: str(r.cpioRef),
    deadline: str(r.deadline),
    status: str(r.status),
    statusLabel: str(r.statusLabel),
    isOverdue: bool(r.isOverdue),
    createdAt: str(r.createdAt),
    updatedAt: str(r.updatedAt),
    responses: asArray(r.responses).map(toRtiResponse),
    appeals: asArray(r.appeals).map(toRtiAppeal),
  };
}

/**
 * PERF-009 tranche 3: same rationale and shape as getGrievanceDetail (tranche
 * 2) — fetches the RTI application server-side during SSR instead of
 * shipping the page empty and having the client re-fetch after hydration.
 * RTIDetailClient still keeps its own client-side `load()` — used to refresh
 * after a mutation (respond/appeal), and as a same-as-before fallback on
 * first mount when this loader's `source` comes back "error" (no base URL /
 * unauthenticated / network failure / bad shape), so resilience is unchanged
 * from before this loader existed.
 */
export function getRtiDetail(id: string): Promise<LoaderResult<RtiDetail | null>> {
  return fetchJson<unknown, RtiDetail | null>(`/api/v1/citizen/rti/${id}`, null, {
    telemetryKey: "citizen.rti.detail",
    mapResponse: (payload) => {
      const r = asObj(payload);
      if (!r || !r.id) return null;
      return toRtiDetail(r);
    },
  });
}
