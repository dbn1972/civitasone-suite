/**
 * Lead Assignment & Escalation client (BRD §7.4, AS-001..AS-004).
 *
 * All calls route through the BFF proxy via browserFetch (httpOnly session,
 * device headers). Read loaders return { source: "error" } on failure so
 * screens render "—" + DataSourceBadge instead of fabricating a zero/empty as
 * fact. Normalisers tolerate a bare array OR an { items | data | rules }
 * wrapper (the backend is being built concurrently — see AS-001..004 contract).
 */
import { browserFetch, errorMessageFromResponse } from "@/lib/api/browserClient";

export type AsSource = "api" | "error";

export interface LoaderResult<T> {
  data: T;
  source: AsSource;
}

function num(v: unknown): number {
  return typeof v === "number" ? v : Number(v) || 0;
}
function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}
function bool(v: unknown, dflt = false): boolean {
  return typeof v === "boolean" ? v : dflt;
}

/** Tolerate bare-array vs { items | data | rules | <named> } wrappers. */
function toArray(raw: unknown, ...keys: string[]): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object") {
    for (const k of ["items", "data", "rules", ...keys]) {
      const v = (raw as Record<string, unknown>)[k];
      if (Array.isArray(v)) return v;
    }
  }
  return [];
}

/* ================================================================ AS-001 === */

/** Assignment rule strategies (single source of truth, shared with the UI). */
export const RULE_TYPES = [
  "territory",
  "round_robin",
  "score_threshold",
  "product",
  "segment",
  "language",
  "capacity",
] as const;
export type RuleType = (typeof RULE_TYPES)[number];

/** Human labels for the strategy select. */
export const RULE_TYPE_LABELS: Record<RuleType, string> = {
  territory: "Territory",
  round_robin: "Round robin",
  score_threshold: "Score threshold",
  product: "Product",
  segment: "Segment",
  language: "Language",
  capacity: "Capacity",
};

export interface AssignmentRule {
  id?: string;
  name: string;
  ruleType: RuleType;
  /** Opaque per-strategy criteria, edited as raw JSON text in the UI. */
  criteria: Record<string, unknown>;
  ordinal: number;
  enabled: boolean;
  fallbackOwnerId: string;
}

export function normaliseRule(raw: unknown): AssignmentRule | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const name = str(r.name);
  if (!name) return null;
  const rt = str(r.ruleType);
  return {
    ...(typeof r.id === "string" ? { id: r.id } : {}),
    name,
    ruleType: (RULE_TYPES as readonly string[]).includes(rt) ? (rt as RuleType) : "territory",
    criteria:
      r.criteria && typeof r.criteria === "object" && !Array.isArray(r.criteria)
        ? (r.criteria as Record<string, unknown>)
        : {},
    ordinal: num(r.ordinal),
    enabled: bool(r.enabled, true),
    fallbackOwnerId: str(r.fallbackOwnerId),
  };
}

export function normaliseRules(raw: unknown): AssignmentRule[] {
  return toArray(raw)
    .map(normaliseRule)
    .filter((r): r is AssignmentRule => r !== null);
}

export async function getAssignmentRules(): Promise<LoaderResult<AssignmentRule[]>> {
  try {
    const res = await browserFetch("v1/crm/assignment-rules");
    if (!res.ok) return { data: [], source: "error" };
    return { data: normaliseRules(await res.json()), source: "api" };
  } catch {
    return { data: [], source: "error" };
  }
}

export async function createAssignmentRule(rule: AssignmentRule): Promise<void> {
  const res = await browserFetch("v1/crm/assignment-rules", {
    method: "POST",
    body: JSON.stringify(rule),
  });
  if (!res.ok) throw new Error(await errorMessageFromResponse(res));
}

export async function updateAssignmentRule(id: string, rule: AssignmentRule): Promise<void> {
  const res = await browserFetch(`v1/crm/assignment-rules/${id}`, {
    method: "PUT",
    body: JSON.stringify(rule),
  });
  if (!res.ok) throw new Error(await errorMessageFromResponse(res));
}

export async function deleteAssignmentRule(id: string): Promise<void> {
  const res = await browserFetch(`v1/crm/assignment-rules/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(await errorMessageFromResponse(res));
}

export interface AssignResult {
  /** True when the backend accepted the change asynchronously (HTTP 202). */
  accepted: boolean;
}

/**
 * Assign a lead. Either hand it to a specific owner ({ ownerId }) or run the
 * configured rule chain ({ runRules: true }). Returns whether the change was
 * accepted async (202) so the UI can word the confirmation honestly.
 */
export async function assignLead(
  leadId: string,
  body: { ownerId: string } | { runRules: true },
): Promise<AssignResult> {
  const res = await browserFetch(`v1/crm/leads/${leadId}/assign`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await errorMessageFromResponse(res));
  return { accepted: res.status === 202 };
}

export type AssignMethod = "auto" | "manual" | "transfer";

export interface AssignmentLogEntry {
  ownerId: string;
  ruleId: string;
  method: AssignMethod;
  assignedAt: string;
  assignedBy: string;
  /** Present once the assignee accepts (AS-004); absent while pending. */
  acceptedAt?: string;
}

const ASSIGN_METHODS: AssignMethod[] = ["auto", "manual", "transfer"];

export function normaliseLog(raw: unknown): AssignmentLogEntry[] {
  const out: AssignmentLogEntry[] = [];
  for (const item of toArray(raw, "log", "history", "entries")) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const m = str(r.method);
    out.push({
      ownerId: str(r.ownerId),
      ruleId: str(r.ruleId),
      method: (ASSIGN_METHODS as string[]).includes(m) ? (m as AssignMethod) : "manual",
      assignedAt: str(r.assignedAt),
      assignedBy: str(r.assignedBy),
      ...(typeof r.acceptedAt === "string" && r.acceptedAt ? { acceptedAt: r.acceptedAt } : {}),
    });
  }
  return out;
}

export async function getAssignmentLog(leadId: string): Promise<LoaderResult<AssignmentLogEntry[]>> {
  try {
    const res = await browserFetch(`v1/crm/leads/${leadId}/assignment-log`);
    if (!res.ok) return { data: [], source: "error" };
    return { data: normaliseLog(await res.json()), source: "api" };
  } catch {
    return { data: [], source: "error" };
  }
}

/* ================================================================ AS-002 === */

/** The four ownership-directory resources managed by the same editor. */
export const OWNERSHIP_RESOURCES = [
  "assignment-queues",
  "territories",
  "partners",
  "branches",
] as const;
export type OwnershipResource = (typeof OWNERSHIP_RESOURCES)[number];

export const OWNERSHIP_RESOURCE_LABELS: Record<OwnershipResource, string> = {
  "assignment-queues": "Queues",
  territories: "Territories",
  partners: "Partners",
  branches: "Branches",
};

/** A named ownership record; extra backend fields are carried through opaquely. */
export interface NamedResource {
  id?: string;
  name: string;
  description: string;
  enabled: boolean;
}

export function normaliseResources(raw: unknown): NamedResource[] {
  const out: NamedResource[] = [];
  for (const item of toArray(raw)) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const name = str(r.name);
    if (!name) continue;
    out.push({
      ...(typeof r.id === "string" ? { id: r.id } : {}),
      name,
      description: str(r.description),
      enabled: bool(r.enabled, true),
    });
  }
  return out;
}

export async function getResources(resource: OwnershipResource): Promise<LoaderResult<NamedResource[]>> {
  try {
    const res = await browserFetch(`v1/crm/${resource}`);
    if (!res.ok) return { data: [], source: "error" };
    return { data: normaliseResources(await res.json()), source: "api" };
  } catch {
    return { data: [], source: "error" };
  }
}

export async function createResource(resource: OwnershipResource, body: NamedResource): Promise<void> {
  const res = await browserFetch(`v1/crm/${resource}`, { method: "POST", body: JSON.stringify(body) });
  if (!res.ok) throw new Error(await errorMessageFromResponse(res));
}

export async function updateResource(
  resource: OwnershipResource,
  id: string,
  body: NamedResource,
): Promise<void> {
  const res = await browserFetch(`v1/crm/${resource}/${id}`, { method: "PUT", body: JSON.stringify(body) });
  if (!res.ok) throw new Error(await errorMessageFromResponse(res));
}

export async function deleteResource(resource: OwnershipResource, id: string): Promise<void> {
  const res = await browserFetch(`v1/crm/${resource}/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(await errorMessageFromResponse(res));
}

/**
 * Transfer ownership of a contact/lead to another owner (AS-002). The backend
 * requires a non-empty reason for the audit trail alongside the target owner.
 */
export async function transferOwnership(
  contactId: string,
  toOwnerId: string,
  reason: string,
): Promise<AssignResult> {
  const res = await browserFetch(`v1/crm/contacts/${contactId}/transfer`, {
    method: "POST",
    body: JSON.stringify({ toOwnerId, reason }),
  });
  if (!res.ok) throw new Error(await errorMessageFromResponse(res));
  return { accepted: res.status === 202 };
}

/* ================================================================ AS-003 === */

export interface AgentWorkload {
  agentId: string;
  name: string;
  /** Current open lead count (read-only, from the backend). */
  activeLeads: number;
  maxLeads: number;
  available: boolean;
  onLeave: boolean;
}

export function normaliseAgents(raw: unknown): AgentWorkload[] {
  const out: AgentWorkload[] = [];
  for (const item of toArray(raw, "agents")) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const agentId = str(r.agentId) || str(r.id);
    if (!agentId) continue;
    out.push({
      agentId,
      name: str(r.name) || agentId,
      activeLeads: num(r.activeLeads ?? r.currentLoad ?? r.currentLeads ?? r.openLeads),
      maxLeads: num(r.maxLeads),
      available: bool(r.available, true),
      onLeave: bool(r.onLeave, false),
    });
  }
  return out;
}

export async function getAgents(): Promise<LoaderResult<AgentWorkload[]>> {
  try {
    const res = await browserFetch("v1/crm/teams/agents");
    if (!res.ok) return { data: [], source: "error" };
    return { data: normaliseAgents(await res.json()), source: "api" };
  } catch {
    return { data: [], source: "error" };
  }
}

export interface CapacityPatch {
  maxLeads: number;
  available: boolean;
  onLeave: boolean;
}

export async function updateAgentCapacity(agentId: string, patch: CapacityPatch): Promise<void> {
  const res = await browserFetch(`v1/crm/teams/agents/${agentId}/capacity`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(await errorMessageFromResponse(res));
}

/* ================================================================ AS-004 === */

export const ESCALATION_TRIGGERS = ["unaccepted", "unattended"] as const;
export type EscalationTrigger = (typeof ESCALATION_TRIGGERS)[number];

export const ESCALATION_TRIGGER_LABELS: Record<EscalationTrigger, string> = {
  unaccepted: "Not accepted in time",
  unattended: "No activity in time",
};

export interface EscalationRule {
  id?: string;
  trigger: EscalationTrigger;
  thresholdMinutes: number;
  /** Escalate to a role OR a specific user — exactly one is used at a time. */
  recipientRole: string;
  recipientId: string;
  /** Whether the lead is also reassigned when escalated. */
  reassign: boolean;
  enabled: boolean;
}

export function normaliseEscalationRule(raw: unknown): EscalationRule | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const t = str(r.trigger);
  return {
    ...(typeof r.id === "string" ? { id: r.id } : {}),
    trigger: (ESCALATION_TRIGGERS as readonly string[]).includes(t) ? (t as EscalationTrigger) : "unaccepted",
    thresholdMinutes: num(r.thresholdMinutes),
    recipientRole: str(r.recipientRole),
    recipientId: str(r.recipientId),
    reassign: bool(r.reassign, false),
    enabled: bool(r.enabled, true),
  };
}

export function normaliseEscalationRules(raw: unknown): EscalationRule[] {
  return toArray(raw)
    .map(normaliseEscalationRule)
    .filter((r): r is EscalationRule => r !== null);
}

export async function getEscalationRules(): Promise<LoaderResult<EscalationRule[]>> {
  try {
    const res = await browserFetch("v1/crm/escalation-rules");
    if (!res.ok) return { data: [], source: "error" };
    return { data: normaliseEscalationRules(await res.json()), source: "api" };
  } catch {
    return { data: [], source: "error" };
  }
}

export async function createEscalationRule(rule: EscalationRule): Promise<void> {
  const res = await browserFetch("v1/crm/escalation-rules", { method: "POST", body: JSON.stringify(rule) });
  if (!res.ok) throw new Error(await errorMessageFromResponse(res));
}

export async function updateEscalationRule(id: string, rule: EscalationRule): Promise<void> {
  const res = await browserFetch(`v1/crm/escalation-rules/${id}`, { method: "PUT", body: JSON.stringify(rule) });
  if (!res.ok) throw new Error(await errorMessageFromResponse(res));
}

export async function deleteEscalationRule(id: string): Promise<void> {
  const res = await browserFetch(`v1/crm/escalation-rules/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(await errorMessageFromResponse(res));
}

/** Accept a lead assigned to the current user (AS-004). */
export async function acceptLead(leadId: string): Promise<AssignResult> {
  const res = await browserFetch(`v1/crm/leads/${leadId}/accept`, { method: "POST" });
  if (!res.ok) throw new Error(await errorMessageFromResponse(res));
  return { accepted: res.status === 202 };
}

/** Whole minutes between an ISO timestamp and now (>=0, 0 on unparseable). */
export function minutesSince(iso: string, now: number = Date.now()): number {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.floor((now - t) / 60000));
}

/** Compact human ageing label ("3h 12m", "just now") from whole minutes. */
export function formatAgeing(minutes: number): string {
  if (minutes <= 0) return "just now";
  const d = Math.floor(minutes / 1440);
  const h = Math.floor((minutes % 1440) / 60);
  const m = minutes % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export interface AgeingState {
  /** Latest assignment (log[0]) or null when there is none. */
  latest: AssignmentLogEntry | null;
  minutesSinceAssigned: number;
  /** Assigned but not yet accepted. */
  pendingAcceptance: boolean;
}

/** Derive the ageing/overdue state of a lead from its assignment log. */
export function ageingFromLog(log: AssignmentLogEntry[], now: number = Date.now()): AgeingState {
  const latest = log.length > 0 ? log[0] : null;
  if (!latest) return { latest: null, minutesSinceAssigned: 0, pendingAcceptance: false };
  return {
    latest,
    minutesSinceAssigned: latest.assignedAt ? minutesSince(latest.assignedAt, now) : 0,
    pendingAcceptance: !latest.acceptedAt,
  };
}
