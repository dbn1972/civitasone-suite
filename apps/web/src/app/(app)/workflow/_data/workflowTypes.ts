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
