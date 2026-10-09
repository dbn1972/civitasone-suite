/**
 * Client-safe workflow types + pure formatting helpers.
 *
 * This module has NO server-only imports (no next/headers), so it can be
 * imported from both Server Components (the data layer / pages) and Client
 * Components (the interactive tables). The server fetchers live in
 * `workflowData.ts`, which re-exports these types for convenience.
 */

export type WorkflowSource = "api" | "error";
export interface WorkflowResult<T> {
  data: T;
  source: WorkflowSource;
  status?: number;
  /**
   * GAP2-WORKFLOW-MY-TASKS-02 — the exact total of the WHOLE (unpaged) matching
   * set, when the endpoint reports it (tasks list `pagination.total`). Lets a
   * capped list surface a true "N of M" / "200+" instead of a flat window count.
   */
  total?: number;
}

export interface WorkflowDefinition {
  id: string;
  code: string;
  name: string;
  version: number;
  status: string;
  description?: string | null;
  isTemplate?: boolean;
}

export interface WorkflowNode {
  nodeKey: string;
  name: string;
  nodeType: string;
  roleRef: string | null;
  slaMinutes: number | null;
  assignStrategy: string | null;
  sortOrder: number | null;
}

export interface WorkflowEdge {
  fromNode: string;
  toNode: string;
  condition: string | null;
  sortOrder: number | null;
}

export interface WorkflowDefinitionDetail extends WorkflowDefinition {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

export interface WorkflowInstance {
  id: string;
  name: string;
  status: string;
  version: number;
  // GAP-WORKFLOW-LIST-03 — optional subject/definition/step/date fields the
  // list mapper now reads so the table can show what/where/how-old. Optional
  // so callers that only have the slim shape still typecheck.
  definitionName?: string | null;
  definitionCode?: string | null;
  refType?: string | null;
  refId?: string | null;
  currentNode?: string | null;
  createdAt?: string | null;
}

/** Full single-instance detail from GET /v1/workflow/instances/:id. */
export interface WorkflowInstanceDetail extends WorkflowInstance {
  definitionId: string | null;
  definitionCode: string | null;
  definitionName: string | null;
  refType: string | null;
  refId: string | null;
  currentNode: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface WorkflowTransition {
  id: string;
  fromNode: string | null;
  toNode: string | null;
  action: string;
  decision: string | null;
  actorId: string;
  // GAP-WORKFLOW-INSTANCES-DETAIL-01 — optional, server-resolved display name
  // for actorId (via the shared tenant-scoped user directory). Optional so
  // callers that have only the id still typecheck; the timeline shows the name
  // when present and an honest short id otherwise, never a guess.
  actorName?: string | null;
  createdAt: string;
  detail?: Record<string, unknown>;
}

export interface WorkflowTask {
  id: string;
  instanceId: string;
  name: string;
  status: string;
  roleRef: string | null;
  nodeKey: string | null;
  refType: string | null;
  refId: string | null;
  decision: string | null;
  assigneeId: string | null;
  // GAP-WORKFLOW-INSTANCES-DETAIL-01 — optional, server-resolved display name
  // for assigneeId (via the shared tenant-scoped user directory). Optional so
  // callers that have only the id still typecheck.
  assigneeName?: string | null;
  // GAP-WORKFLOW-MY-TASKS-05 — age (createdAt) + SLA (dueAt) so the inbox can
  // show Age/Due columns and sort oldest/most-overdue first. Optional/null.
  createdAt?: string | null;
  dueAt?: string | null;
  version: number;
}

export interface WorkflowAnalytics {
  instancesByStatus: Record<string, number>;
  totalInstances: number;
  avgCycleTimeSeconds: number | null;
  completedCount: number;
  slaBreachRate: number;
  slaBreachedTasks: number;
  slaTrackedTasks: number;
  escalations: number;
}

/* ── pure helpers (client-safe) ─────────────────────────────────── */

export function formatDuration(seconds: number | null): string {
  if (seconds == null || !Number.isFinite(seconds)) return "—";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const mins = seconds / 60;
  if (mins < 60) return `${Math.round(mins)}m`;
  const hrs = mins / 60;
  if (hrs < 24) return `${hrs.toFixed(1)}h`;
  return `${(hrs / 24).toFixed(1)}d`;
}

export function titleCase(s: string): string {
  return s.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * GAP-WORKFLOW-HOME-03 — single source of truth for the "in progress" instance
 * population. Both the hub (page.tsx) and the Instances list (list/page.tsx)
 * must count the same statuses (active + pending + running) so the same cohort
 * is never shown as two different numbers one click apart.
 */
export function inProgressCount(instancesByStatus: Record<string, number>): number {
  return (
    (instancesByStatus["active"] ?? 0) +
    (instancesByStatus["pending"] ?? 0) +
    (instancesByStatus["running"] ?? 0)
  );
}

/**
 * GAP2-WORKFLOW-DEFINITIONS-03 — the authoritative "live" (deployed) status set
 * for workflow.definitions. The service's DB CHECK constraint restricts the
 * column to exactly `('active', 'draft', 'archived')` (workflow-service
 * migration 0019_check_constraints_status_columns.sql) and `deployDefinition`
 * sets `status = 'active'`; there is NO `deployed`/`published` literal anywhere
 * in the service. The old web predicate counted `active || deployed`, where
 * `deployed` was a phantom that never matched and `draft`/`archived` were (correctly)
 * excluded. Centralised here so web and DB agree in one place.
 */
export const LIVE_DEFINITION_STATUSES: readonly string[] = ["active"] as const;

/** True when a definition's status is one the service treats as live/deployed. */
export function isLiveDefinition(status: string): boolean {
  return LIVE_DEFINITION_STATUSES.includes(status);
}

/**
 * GAP2-WORKFLOW-INSTANCES-DETAIL-02 — human label for a raw refType enum code
 * (e.g. "procurement_po" → "Purchase Order"). Mirrors the refType vocabulary
 * that loaders.ts buildApprovalLink() maps for the approvals inbox so the two
 * surfaces name the same subject the same way. An unknown code falls back to a
 * title-cased version of the raw token rather than printing the enum verbatim.
 */
const REF_TYPE_LABELS: Record<string, string> = {
  leave_app: "Leave Application",
  payroll_run: "Payroll Run",
  procurement_indent: "Procurement Indent",
  procurement_po: "Purchase Order",
  finance_bill: "Finance Bill",
  estab_file: "Establishment File",
};
export function humanizeRefType(refType: string): string {
  return REF_TYPE_LABELS[refType] ?? titleCase(refType);
}

/**
 * GAP2-WORKFLOW-INSTANCES-DETAIL-02 — the refTypes that buildApprovalLink maps
 * to a *record* detail route (as opposed to falling back to a workflow route).
 * Used to decide whether the linked-record control deep-links to the source
 * record or stays on the workflow instance.
 */
const DEEP_LINKED_REF_TYPES = new Set([
  "leave_app",
  "payroll_run",
  "procurement_indent",
  "procurement_po",
  "finance_bill",
  "estab_file",
]);
export function hasRefDeepLink(refType: string): boolean {
  return DEEP_LINKED_REF_TYPES.has(refType);
}

/**
 * GAP-WORKFLOW-HOME-04 — format the SLA breach rate for display. The
 * workflow-service analytics contract returns `slaBreachRate` as a 0..1
 * fraction (breachedTasks / trackedTasks; see analytics/queries.ts summary()).
 * Render as a percentage; when there are no SLA-tracked tasks the rate is a
 * meaningless 0, so show an explicit em dash instead of a false "0.0%".
 */
export function formatBreachRate(rate: number, trackedTasks: number): string {
  if (!Number.isFinite(rate) || trackedTasks <= 0) return "—";
  const clamped = Math.max(0, Math.min(1, rate));
  return `${(clamped * 100).toFixed(1)}%`;
}

/**
 * GAP-WORKFLOW-DEFINITIONS-DETAIL-04 — human-readable SLA from a minutes value
 * (reuses formatDuration's day/hour/minute logic). Returns null for a missing
 * SLA so callers can omit the pill entirely.
 */
export function formatSlaMinutes(slaMinutes: number | null): string | null {
  if (slaMinutes == null || !Number.isFinite(slaMinutes)) return null;
  return formatDuration(slaMinutes * 60);
}
