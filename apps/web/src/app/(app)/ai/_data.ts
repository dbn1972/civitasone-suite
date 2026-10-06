/**
 * ai-agent route-group server loaders — SCORE_LOCK F1 child pages.
 * Calls ai-agent-service through the gateway via cookie-aware fetchJson.
 */
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import type { ModuleRowSummary } from "@civitasone/types";
import {
  mapAgentStatuses,
  mapAuditEntries,
  mapGovernanceCounters,
  type AgentStatus,
  type AuditEntry,
  type GovernanceCounters,
} from "./governance/governance";
// GAP-AI-GUARDRAILS-02/03: typed guardrail rule mapper.
import { mapGuardrailRules, type GuardrailRule } from "./guardrails/guardrails";

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

export const getAiAgents = moduleLoader("/api/v1/ai/agents", "ai.agents");
export const getAiGuardrails = moduleLoader("/api/v1/ai/guardrails/rules", "ai.guardrails");

/**
 * GAP-AI-AGENTS-02 / -03: a typed agents row for the dedicated /ai/agents table
 * (fixed columns: name, status, description, updated), rather than the generic
 * ModuleListTable whose Detail/Meta columns are guessed per-row and whose Meta
 * printed a raw ISO timestamp. Mapped defensively from the ai-agent-service
 * agents endpoint (id/name/status/updatedAt/createdAt), so a missing field
 * degrades to a dash rather than throwing.
 */
export interface AiAgentRow {
  id: string;
  name: string;
  status: string;
  updatedAt: string | null;
}

function mapAgentRows(payload: unknown): AiAgentRow[] {
  const out: AiAgentRow[] = [];
  for (const [index, row] of extractRows(payload).entries()) {
    if (!isRecord(row)) continue;
    const id = toText(row.id) ?? toText(row.agentId) ?? `row-${index + 1}`;
    const name = toText(row.name) ?? toText(row.title) ?? id;
    const status = toText(row.status) ?? toText(row.state) ?? "unknown";
    const updatedAt = toText(row.updatedAt) ?? toText(row.createdAt) ?? null;
    out.push({ id, name, status, updatedAt });
  }
  return out;
}

/** Agent definitions as typed rows for the dedicated agents table. */
export function getAiAgentRows(): Promise<LoaderResult<AiAgentRow[]>> {
  return fetchJson<unknown, AiAgentRow[]>("/api/v1/ai/agents?limit=100", [] as AiAgentRow[], {
    revalidateSeconds: 30,
    telemetryKey: "ai.agents.rows",
    mapResponse: mapAgentRows,
  });
}

/**
 * GAP-AI-GUARDRAILS-02/03: typed guardrail rules for the Guardrails page's
 * domain-specific table (code/type/severity/status), instead of the generic
 * ModuleListPage mapper that guesses columns per row.
 */
export function getAiGuardrailRules(): Promise<LoaderResult<GuardrailRule[]>> {
  return fetchJson<unknown, GuardrailRule[]>("/api/v1/ai/guardrails/rules", [] as GuardrailRule[], {
    revalidateSeconds: 30,
    telemetryKey: "ai.guardrails_rules",
    mapResponse: mapGuardrailRules,
  });
}

/** Headline governance counters for the AI governance dashboard (P2-10). */
export function getAiGovernanceCounters(): Promise<LoaderResult<GovernanceCounters | null>> {
  return fetchJson<unknown, GovernanceCounters | null>("/api/v1/ai/governance/dashboard", null, {
    revalidateSeconds: 30,
    telemetryKey: "ai.governance_dashboard",
    mapResponse: mapGovernanceCounters,
  });
}

/** Audit trail of AI actions, optionally narrowed to blocked actions only. */
export function getAiGovernanceAudit(opts?: { blocked?: boolean }): Promise<LoaderResult<AuditEntry[]>> {
  const path =
    opts?.blocked === undefined
      ? "/api/v1/ai/governance/audit?limit=100"
      : `/api/v1/ai/governance/audit?limit=100&blocked=${opts.blocked ? "true" : "false"}`;
  return fetchJson<unknown, AuditEntry[]>(path, [] as AuditEntry[], {
    revalidateSeconds: 30,
    telemetryKey: "ai.governance_audit",
    mapResponse: mapAuditEntries,
  });
}

/** Agent definitions with their lifecycle status, for the kill-switch panel. */
export function getAiAgentStatuses(): Promise<LoaderResult<AgentStatus[]>> {
  return fetchJson<unknown, AgentStatus[]>("/api/v1/ai/agents?limit=100", [] as AgentStatus[], {
    revalidateSeconds: 30,
    telemetryKey: "ai.agent_statuses",
    mapResponse: mapAgentStatuses,
  });
}
