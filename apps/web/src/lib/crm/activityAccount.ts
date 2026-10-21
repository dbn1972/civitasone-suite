/**
 * Activity / Follow-up & Account / Contact 360 client
 * (BRD §7.5 AC-001..AC-005, §7.6 CM-001..CM-004).
 *
 * Every call routes through the BFF proxy via browserFetch (httpOnly session +
 * device headers). Read loaders return { source: "error" } on failure so
 * screens render "—" + DataSourceBadge instead of fabricating a zero/empty as
 * fact. Normalisers tolerate a bare array OR an { items | data | <named> }
 * wrapper, and accept both the CONTRACT field names (subjectType/subjectId,
 * dueAt) and the legacy activity fields (contactId/dealId, dueDate) — the
 * crm-service is being extended concurrently, so the UI stays forgiving and any
 * mismatch is reported rather than silently mis-rendered.
 */
import { browserFetch, errorCodeFromResponse, errorMessageFromResponse } from "@/lib/api/browserClient";
import { minutesSince, formatAgeing } from "@/lib/crm/assignment";
import {
  normaliseEscalationRoles,
  normaliseEscalationUsers,
  type EscalationRole,
  type EscalationUser,
} from "./directory";
import { UserFacingError } from "@/lib/userFacingError";

export type AaSource = "api" | "error";
export interface LoaderResult<T> {
  data: T;
  source: AaSource;
}

/** Async-accept signal so the UI can word a 202 honestly. */
export interface AcceptResult {
  accepted: boolean;
}

/* ---------------------------------------------------------------- helpers */

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}
function optStr(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}
function bool(v: unknown, dflt = false): boolean {
  return typeof v === "boolean" ? v : dflt;
}
function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Tolerate bare-array vs { items | data | <named> } wrappers. */
function toArray(raw: unknown, ...keys: string[]): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object") {
    for (const k of ["items", "data", ...keys]) {
      const v = (raw as Record<string, unknown>)[k];
      if (Array.isArray(v)) return v;
    }
  }
  return [];
}

/** Subjects an activity / communication / 360 view can hang off. */
export const SUBJECT_TYPES = ["contact", "account", "lead", "deal"] as const;
export type SubjectType = (typeof SUBJECT_TYPES)[number];

export { minutesSince, formatAgeing };

/* ============================================================ AC-001 ===== */

/** Typed activity vocabulary (single source of truth, shared with the UI). */
export const ACTIVITY_TYPES = ["task", "call", "meeting", "appointment", "note", "reminder"] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export const ACTIVITY_TYPE_LABELS: Record<ActivityType, string> = {
  task: "Task",
  call: "Call",
  meeting: "Meeting",
  appointment: "Appointment",
  note: "Note",
  reminder: "Reminder",
};

/** Types whose composer shows a location field. */
export const ACTIVITY_TYPES_WITH_LOCATION: ActivityType[] = ["meeting", "appointment"];
/** Types whose composer shows a remind-at field. */
export const ACTIVITY_TYPES_WITH_REMIND: ActivityType[] = ["reminder"];
/** Types whose composer shows a due-at field. */
export const ACTIVITY_TYPES_WITH_DUE: ActivityType[] = ["task", "call", "meeting", "appointment", "reminder"];

export interface ActivityInput {
  type: ActivityType;
  subjectType: SubjectType;
  subjectId: string;
  subject?: string;
  text: string;
  /** ISO datetime the activity is due / scheduled. */
  dueAt?: string;
  /** ISO datetime a reminder should fire. */
  remindAt?: string;
  location?: string;
  status?: "open" | "completed" | "cancelled";
}

export interface ActivityEntry {
  id: string;
  type: string;
  subject: string;
  text: string;
  status: string;
  dueAt?: string;
  remindAt?: string;
  location?: string;
  /** The record this activity hangs off, when the payload carries it (AC-001 scoped GET). */
  subjectType?: string;
  subjectId?: string;
  /** Best-effort chronological anchor: createdAt, else dueAt. */
  occurredAt: string;
  createdAt: string;
  actorName?: string;
}

export function normaliseActivity(raw: unknown): ActivityEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = str(r.id);
  if (!id) return null;
  const createdAt = str(r.createdAt) || str(r.occurredAt);
  const dueAt = optStr(r.dueAt) ?? optStr(r.dueDate);
  return {
    id,
    type: str(r.type) || "note",
    subject: str(r.subject),
    text: str(r.text),
    status: str(r.status) || "open",
    ...(dueAt ? { dueAt } : {}),
    ...(optStr(r.remindAt) ? { remindAt: str(r.remindAt) } : {}),
    ...(optStr(r.location) ? { location: str(r.location) } : {}),
    ...(optStr(r.subjectType) ? { subjectType: str(r.subjectType) } : {}),
    ...(optStr(r.subjectId) ? { subjectId: str(r.subjectId) } : {}),
    occurredAt: createdAt || dueAt || "",
    createdAt,
    ...(optStr(r.actorName) ? { actorName: str(r.actorName) } : {}),
  };
}

/** Newest first. */
export function normaliseActivities(raw: unknown): ActivityEntry[] {
  return toArray(raw, "activities")
    .map(normaliseActivity)
    .filter((a): a is ActivityEntry => a !== null)
    .sort((a, b) => (b.occurredAt > a.occurredAt ? 1 : b.occurredAt < a.occurredAt ? -1 : 0));
}

export async function getActivities(
  subjectType: SubjectType,
  subjectId: string,
): Promise<LoaderResult<ActivityEntry[]>> {
  try {
    const res = await browserFetch(
      `v1/crm/activities?subjectType=${encodeURIComponent(subjectType)}&subjectId=${encodeURIComponent(subjectId)}`,
    );
    if (!res.ok) return { data: [], source: "error" };
    return { data: normaliseActivities(await res.json()), source: "api" };
  } catch {
    return { data: [], source: "error" };
  }
}

export async function createActivity(input: ActivityInput): Promise<AcceptResult> {
  // Send the contract body, plus legacy back-compat fields (contactId/dealId,
  // dueDate) so the endpoint persists it whether or not it has been re-typed.
  const legacy: Record<string, unknown> = {};
  if (input.subjectType === "contact" || input.subjectType === "lead") legacy.contactId = input.subjectId;
  if (input.subjectType === "deal") legacy.dealId = input.subjectId;
  if (input.dueAt) legacy.dueDate = input.dueAt.slice(0, 10);
  const res = await browserFetch("v1/crm/activities", {
    method: "POST",
    body: JSON.stringify({
      type: input.type,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      text: input.text,
      status: input.status ?? "open",
      ...(input.subject ? { subject: input.subject } : {}),
      ...(input.dueAt ? { dueAt: input.dueAt } : {}),
      ...(input.remindAt ? { remindAt: input.remindAt } : {}),
      ...(input.location ? { location: input.location } : {}),
      ...legacy,
    }),
  });
  if (!res.ok) throw new UserFacingError(await errorMessageFromResponse(res));
  return { accepted: res.status === 202 };
}

/* ============================================================ AC-005 ===== */

export const ESCALATION_APPLIES_TO = ["next_action", "task", "both"] as const;
export type EscalationAppliesTo = (typeof ESCALATION_APPLIES_TO)[number];

export interface TaskEscalationRule {
  id?: string;
  /** Short label for the rule. crm-service requires one (max 200 chars). */
  name?: string;
  /** What the rule watches; crm-service defaults to "both" when unset. */
  appliesTo?: EscalationAppliesTo;
  /** Escalate a task overdue by more than this many minutes. */
  thresholdMinutes: number;
  /**
   * Escalate to a manager role OR a specific manager — one is used. These are the
   * editor's names; on the wire they are crm-service's `recipientRole` /
   * `recipientId` (see taskEscalationRuleBody / normaliseTaskEscalationRule).
   */
  managerRole: string;
  managerId: string;
  enabled: boolean;
}

export function normaliseTaskEscalationRule(raw: unknown): TaskEscalationRule | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const threshold = numOrNull(r.thresholdMinutes);
  const appliesTo = ESCALATION_APPLIES_TO.find((a) => a === r.appliesTo);
  return {
    ...(typeof r.id === "string" ? { id: r.id } : {}),
    ...(optStr(r.name) ? { name: str(r.name) } : {}),
    ...(appliesTo ? { appliesTo } : {}),
    thresholdMinutes: threshold ?? 0,
    // crm-service stores the manager as recipientRole / recipientId. Reading only
    // managerRole/managerId (names no service uses) meant a saved manager was never
    // shown again - every rule looked like it had none. Accept the legacy names too.
    managerRole: str(r.recipientRole) || str(r.managerRole),
    managerId: str(r.recipientId) || str(r.managerId),
    enabled: bool(r.enabled, true),
  };
}

/**
 * The request body crm-service's task-escalation-rules routes accept. The editor's
 * managerRole/managerId map to recipientRole/recipientId, and `name` (required by the
 * service) is always sent - posting the editor's own shape 400'd because it had no name
 * and the manager fields were unknown to the schema.
 */
export function taskEscalationRuleBody(rule: TaskEscalationRule): Record<string, unknown> {
  return {
    name: (rule.name ?? "").trim(),
    appliesTo: rule.appliesTo ?? "both",
    thresholdMinutes: rule.thresholdMinutes,
    recipientRole: rule.managerRole.trim() || null,
    recipientId: rule.managerId.trim() || null,
    enabled: rule.enabled,
  };
}

/**
 * crm-service refused a rule for a reason the editor can word precisely (a recipient that does
 * not exist, no recipient, the directory unreachable). `code` is the server's machine code; the
 * editor maps it to translated copy - the code itself is never shown.
 */
export const RULE_REJECTION_CODES = [
  "INVALID_RECIPIENT_ROLE",
  "INVALID_RECIPIENT",
  "RECIPIENT_REQUIRED",
  "DIRECTORY_UNAVAILABLE",
  "IDENTITY_UNAVAILABLE",
] as const;
export type RuleRejectionCode = (typeof RULE_REJECTION_CODES)[number];

export class TaskEscalationRuleRejected extends UserFacingError {
  readonly code: RuleRejectionCode;
  constructor(code: RuleRejectionCode, message: string) {
    super(message);
    this.code = code;
  }
}

async function throwRuleFailure(res: Response): Promise<never> {
  const code = await errorCodeFromResponse(res);
  const known = RULE_REJECTION_CODES.find((c) => c === code);
  const message = await errorMessageFromResponse(res);
  if (known) throw new TaskEscalationRuleRejected(known, message);
  throw new UserFacingError(message);
}

export function normaliseTaskEscalationRules(raw: unknown): TaskEscalationRule[] {
  return toArray(raw, "rules")
    .map(normaliseTaskEscalationRule)
    .filter((r): r is TaskEscalationRule => r !== null);
}

export async function getTaskEscalationRules(): Promise<LoaderResult<TaskEscalationRule[]>> {
  try {
    const res = await browserFetch("v1/crm/task-escalation-rules");
    if (!res.ok) return { data: [], source: "error" };
    return { data: normaliseTaskEscalationRules(await res.json()), source: "api" };
  } catch {
    return { data: [], source: "error" };
  }
}

/* -- GAP-CRM-TASK-ESCALATION-01: role + user pickers for escalation targets -- */

/*
 * The role / user shapes and their normalisers live in ./directory (shared with the lead
 * escalation editor in assignment.ts); re-exported here so existing importers keep working.
 */
export { normaliseEscalationRoles, normaliseEscalationUsers };
export type { EscalationRole, EscalationUser };

/**
 * GAP-CRM-TASK-ESCALATION-01: the tenant's assignable roles. A free-text role
 * input let a mistyped role save as valid so tasks escalated to nobody; the
 * editor now picks from this list and stores the role key.
 */
export async function getEscalationRoles(): Promise<LoaderResult<EscalationRole[]>> {
  try {
    // crm-service's directory (admin tier), not the platform-admin-only policy/roles.
    const res = await browserFetch("v1/crm/directory/roles");
    if (!res.ok) return { data: [], source: "error" };
    return { data: normaliseEscalationRoles(await res.json()), source: "api" };
  } catch {
    return { data: [], source: "error" };
  }
}

/**
 * The users a picker offers, plus whether that list is the WHOLE directory. `truncated` is the
 * server's own flag (meta.truncated): the plain list is bounded (and a search shows at most a
 * fixed number of matches), so on a large tenant someone can be missing from it -- the picker says
 * so and offers a name search (searchEscalationUsers) instead of silently omitting people.
 */
export interface EscalationUsersResult extends LoaderResult<EscalationUser[]> {
  truncated?: boolean;
}

async function readEscalationUsers(path: string): Promise<EscalationUsersResult> {
  try {
    // crm-service's own directory (id + name only), open to CRM roles. The admin-only
    // identity/users listing this used to call left every CRM user who was not also a
    // tenant admin with an empty picker.
    const res = await browserFetch(path);
    if (!res.ok) return { data: [], source: "error" };
    const body: unknown = await res.json();
    const meta = body && typeof body === "object" ? (body as { meta?: { truncated?: unknown } }).meta : undefined;
    return { data: normaliseEscalationUsers(body), source: "api", truncated: meta?.truncated === true };
  } catch {
    return { data: [], source: "error" };
  }
}

/** The tenant's users, for the manager user picker (stores the user id). */
export async function getEscalationUsers(): Promise<EscalationUsersResult> {
  return readEscalationUsers("v1/crm/directory/users");
}

/**
 * Server-side NAME search of the tenant's users (2+ characters), for a picker whose plain list is
 * `truncated`. Reaches people the bounded list leaves out; `truncated` is true when the match list
 * itself hit its cap, i.e. the query should be narrowed.
 */
export async function searchEscalationUsers(query: string): Promise<EscalationUsersResult> {
  return readEscalationUsers(`v1/crm/directory/users?q=${encodeURIComponent(query.trim())}`);
}

export async function createTaskEscalationRule(rule: TaskEscalationRule): Promise<void> {
  const res = await browserFetch("v1/crm/task-escalation-rules", {
    method: "POST",
    body: JSON.stringify(taskEscalationRuleBody(rule)),
  });
  if (!res.ok) await throwRuleFailure(res);
}

export async function updateTaskEscalationRule(id: string, rule: TaskEscalationRule): Promise<void> {
  const res = await browserFetch(`v1/crm/task-escalation-rules/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(taskEscalationRuleBody(rule)),
  });
  if (!res.ok) await throwRuleFailure(res);
}

export async function deleteTaskEscalationRule(id: string): Promise<void> {
  const res = await browserFetch(`v1/crm/task-escalation-rules/${id}`, { method: "DELETE" });
  if (!res.ok) throw new UserFacingError(await errorMessageFromResponse(res));
}

export interface OverdueTask {
  id: string;
  subject: string;
  dueAt: string;
  ageMinutes: number;
  /** Display name only — never an opaque id. Undefined when only an id is known. */
  owner?: string;
  /** The raw owner id, kept separate so it is never rendered as a name (GAP-CRM-TASK-ESCALATION-02). */
  ownerId?: string;
  subjectType?: string;
  subjectId?: string;
}

/** Overdue open tasks. Prefers a server flag; else filters open tasks whose
 *  dueAt/dueDate is in the past. */
export function normaliseOverdueTasks(raw: unknown, now: number = Date.now()): OverdueTask[] {
  const out: OverdueTask[] = [];
  for (const item of toArray(raw, "activities", "tasks")) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const id = str(r.id);
    if (!id) continue;
    const type = str(r.type);
    if (type && type !== "task") continue;
    const status = str(r.status);
    if (status && status !== "open") continue;
    const dueAt = optStr(r.dueAt) ?? optStr(r.dueDate);
    if (!dueAt) continue;
    const dueMs = Date.parse(dueAt);
    if (Number.isFinite(dueMs) && dueMs >= now) continue; // not yet overdue
    // GAP-CRM-TASK-ESCALATION-02 (IDLEAK): the Owner column used to fall back
    // owner → actorName → ownerId, so an opaque UUID was printed as the owner
    // when the API sent no name. Keep the id separate: `owner` is a display
    // name ONLY (owner/actorName); `ownerId` carries the raw id for an optional
    // name lookup, and is never rendered verbatim.
    const ownerName = optStr(r.owner) ?? optStr(r.ownerName) ?? optStr(r.actorName);
    const ownerId = optStr(r.ownerId);
    out.push({
      id,
      subject: str(r.subject) || str(r.text).slice(0, 80),
      dueAt,
      ageMinutes: minutesSince(dueAt, now),
      ...(ownerName ? { owner: ownerName } : {}),
      ...(ownerId ? { ownerId } : {}),
      ...(optStr(r.subjectType) ? { subjectType: str(r.subjectType) } : {}),
      ...(optStr(r.subjectId) ? { subjectId: str(r.subjectId) } : {}),
    });
  }
  return out.sort((a, b) => b.ageMinutes - a.ageMinutes);
}

/** Rows per page on the overdue-task monitor (the server allows up to 200). */
export const OVERDUE_PAGE_SIZE = 50;

export interface OverduePage {
  tasks: OverdueTask[];
  /** The REAL number of overdue tasks (meta.total), not the length of this page. */
  total: number;
}

/**
 * One page of overdue open tasks, oldest due date first, plus the true total.
 *
 * GAP-CRM-TASK-ESCALATION-02: the list used to fetch a single capped page (limit=50, no offset)
 * and page it client-side, so tasks past the 50th were unreachable and the headline count
 * understated a big backlog. It now asks the server for the page the reader is on and reports
 * meta.total, so "Showing 51-100 of 214" is true.
 * GAP-CRM-TASK-ESCALATION-06: the dedicated overdue-tasks route. The old query
 * (/v1/crm/activities?type=task&overdue=true) 400'd because that route requires
 * subjectType+subjectId, so the alerts list never loaded.
 */
export async function getOverdueTaskPage(
  opts: { limit?: number; offset?: number } = {},
): Promise<LoaderResult<OverduePage>> {
  const limit = Math.min(Math.max(Math.trunc(opts.limit ?? OVERDUE_PAGE_SIZE), 1), 200);
  const offset = Math.max(Math.trunc(opts.offset ?? 0), 0);
  try {
    const res = await browserFetch(`v1/crm/activities/overdue-tasks?limit=${limit}&offset=${offset}`);
    if (!res.ok) return { data: { tasks: [], total: 0 }, source: "error" };
    const raw: unknown = await res.json();
    const tasks = normaliseOverdueTasks(raw);
    const metaTotal =
      raw && typeof raw === "object" ? numOrNull((raw as { meta?: { total?: unknown } }).meta?.total) : null;
    return { data: { tasks, total: metaTotal !== null && metaTotal >= 0 ? metaTotal : tasks.length }, source: "api" };
  } catch {
    return { data: { tasks: [], total: 0 }, source: "error" };
  }
}

/**
 * How many tasks are overdue by AT LEAST `minAgeMinutes` right now - what a rule with that
 * threshold would match (GAP-CRM-TASK-ESCALATION-01). Asks the server to count (limit=1,
 * meta.total) with the same arithmetic the escalation scheduler uses, rather than counting a
 * capped page here.
 */
export async function getOverdueMatchCount(minAgeMinutes: number): Promise<LoaderResult<number>> {
  const minutes = Math.max(Math.trunc(minAgeMinutes), 0);
  try {
    const res = await browserFetch(`v1/crm/activities/overdue-tasks?limit=1&offset=0&minAgeMinutes=${minutes}`);
    if (!res.ok) return { data: 0, source: "error" };
    const raw: unknown = await res.json();
    const total = raw && typeof raw === "object" ? numOrNull((raw as { meta?: { total?: unknown } }).meta?.total) : null;
    return total === null ? { data: 0, source: "error" } : { data: total, source: "api" };
  } catch {
    return { data: 0, source: "error" };
  }
}

/**
 * GAP-CRM-TASK-ESCALATION-06: snooze an overdue task by pushing its due date
 * out to `dueDate` ("YYYY-MM-DD"). PATCH /v1/crm/activities/:id is the existing
 * CQRS update route (returns 202); the crm-service applies the new due date and
 * emits the activityUpdated audit event inside the transaction. The server
 * enforces role + tenant scope. Throws a clerk-safe error on failure.
 */
export async function snoozeTask(id: string, dueDate: string, reason: string): Promise<AcceptResult> {
  const res = await browserFetch(`v1/crm/activities/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({ dueDate, reason }),
  });
  if (!res.ok) throw new UserFacingError(await errorMessageFromResponse(res));
  return { accepted: res.status === 202 };
}

/**
 * GAP-CRM-TASK-ESCALATION-06: reassign an overdue task to another user. The
 * reason (10+ chars) is required and is recorded on the audit event.
 */
export async function reassignTask(id: string, ownerId: string, reason: string): Promise<AcceptResult> {
  const res = await browserFetch(`v1/crm/activities/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({ ownerId, reason }),
  });
  if (!res.ok) throw new UserFacingError(await errorMessageFromResponse(res));
  return { accepted: res.status === 202 };
}

/* ============================================================ AC-003 ===== */

export const COMM_DIRECTIONS = ["inbound", "outbound"] as const;
export type CommDirection = (typeof COMM_DIRECTIONS)[number];
export const COMM_DIRECTION_LABELS: Record<CommDirection, string> = {
  inbound: "Inbound",
  outbound: "Outbound",
};

export const COMM_CHANNELS = ["email", "phone", "sms", "whatsapp", "portal", "meeting", "other"] as const;
export type CommChannel = (typeof COMM_CHANNELS)[number];
export const COMM_CHANNEL_LABELS: Record<CommChannel, string> = {
  email: "Email",
  phone: "Phone",
  sms: "SMS",
  whatsapp: "WhatsApp",
  portal: "Portal",
  meeting: "Meeting",
  other: "Other",
};

export interface CommunicationInput {
  subjectType: SubjectType;
  subjectId: string;
  direction: CommDirection;
  channel: CommChannel;
  outcome?: string;
  disposition?: string;
  occurredAt: string;
  summary: string;
}

export interface CommunicationEntry {
  id: string;
  direction: string;
  channel: string;
  outcome?: string;
  disposition?: string;
  occurredAt: string;
  summary: string;
}

export function normaliseCommunication(raw: unknown): CommunicationEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = str(r.id);
  if (!id) return null;
  return {
    id,
    direction: str(r.direction) || "outbound",
    channel: str(r.channel) || "other",
    ...(optStr(r.outcome) ? { outcome: str(r.outcome) } : {}),
    ...(optStr(r.disposition) ? { disposition: str(r.disposition) } : {}),
    occurredAt: str(r.occurredAt) || str(r.createdAt) || str(r.sentAt),
    summary: str(r.summary) || str(r.text),
  };
}

/** Newest first. */
export function normaliseCommunications(raw: unknown): CommunicationEntry[] {
  return toArray(raw, "communications")
    .map(normaliseCommunication)
    .filter((c): c is CommunicationEntry => c !== null)
    .sort((a, b) => (b.occurredAt > a.occurredAt ? 1 : b.occurredAt < a.occurredAt ? -1 : 0));
}

export async function getCommunications(
  subjectType: SubjectType,
  subjectId: string,
): Promise<LoaderResult<CommunicationEntry[]>> {
  try {
    const res = await browserFetch(
      `v1/crm/communications?subjectType=${encodeURIComponent(subjectType)}&subjectId=${encodeURIComponent(subjectId)}`,
    );
    if (!res.ok) return { data: [], source: "error" };
    return { data: normaliseCommunications(await res.json()), source: "api" };
  } catch {
    return { data: [], source: "error" };
  }
}

export async function createCommunication(input: CommunicationInput): Promise<AcceptResult> {
  const res = await browserFetch("v1/crm/communications", {
    method: "POST",
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new UserFacingError(await errorMessageFromResponse(res));
  return { accepted: res.status === 202 };
}

/* ============================================================ CM-001 ===== */

export const ADDRESS_TYPES = ["billing", "shipping", "registered", "office", "home", "other"] as const;
export type AddressType = (typeof ADDRESS_TYPES)[number];
export const ADDRESS_TYPE_LABELS: Record<AddressType, string> = {
  billing: "Billing",
  shipping: "Shipping",
  registered: "Registered",
  office: "Office",
  home: "Home",
  other: "Other",
};

export type OwnerType = "contact" | "account";

export interface Address {
  id?: string;
  ownerType: OwnerType;
  ownerId: string;
  addressType: AddressType;
  line1: string;
  line2: string;
  city: string;
  state: string;
  pincode: string;
  country: string;
  isPrimary: boolean;
}

export function normaliseAddress(raw: unknown): Address | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const at = str(r.addressType);
  return {
    ...(typeof r.id === "string" ? { id: r.id } : {}),
    ownerType: str(r.ownerType) === "account" ? "account" : "contact",
    ownerId: str(r.ownerId),
    addressType: (ADDRESS_TYPES as readonly string[]).includes(at) ? (at as AddressType) : "other",
    line1: str(r.line1),
    line2: str(r.line2),
    city: str(r.city),
    state: str(r.state),
    pincode: str(r.pincode),
    country: str(r.country) || "India",
    isPrimary: bool(r.isPrimary, false),
  };
}

export function normaliseAddresses(raw: unknown): Address[] {
  return toArray(raw, "addresses")
    .map(normaliseAddress)
    .filter((a): a is Address => a !== null);
}

export async function getAddresses(ownerType: OwnerType, ownerId: string): Promise<LoaderResult<Address[]>> {
  try {
    const res = await browserFetch(
      `v1/crm/addresses?ownerType=${encodeURIComponent(ownerType)}&ownerId=${encodeURIComponent(ownerId)}`,
    );
    if (!res.ok) return { data: [], source: "error" };
    return { data: normaliseAddresses(await res.json()), source: "api" };
  } catch {
    return { data: [], source: "error" };
  }
}

export async function createAddress(body: Address): Promise<void> {
  const res = await browserFetch("v1/crm/addresses", { method: "POST", body: JSON.stringify(body) });
  if (!res.ok) throw new UserFacingError(await errorMessageFromResponse(res));
}

export async function updateAddress(id: string, body: Address): Promise<void> {
  const res = await browserFetch(`v1/crm/addresses/${id}`, { method: "PUT", body: JSON.stringify(body) });
  if (!res.ok) throw new UserFacingError(await errorMessageFromResponse(res));
}

export async function deleteAddress(id: string): Promise<void> {
  const res = await browserFetch(`v1/crm/addresses/${id}`, { method: "DELETE" });
  if (!res.ok) throw new UserFacingError(await errorMessageFromResponse(res));
}

/* ============================================================ CM-003 ===== */

/** Expanded contact-role vocabulary (existing 6 + beneficiary/partner/billing). */
export const CONTACT_ROLES = [
  "decision_maker",
  "influencer",
  "champion",
  "end_user",
  "approver",
  "technical",
  "beneficiary",
  "partner",
  "billing_contact",
] as const;
export type ContactRoleType = (typeof CONTACT_ROLES)[number];

export const CONTACT_ROLE_LABELS: Record<ContactRoleType, string> = {
  decision_maker: "Decision maker",
  influencer: "Influencer",
  champion: "Champion",
  end_user: "End user",
  approver: "Approver",
  technical: "Technical",
  beneficiary: "Beneficiary",
  partner: "Partner",
  billing_contact: "Billing contact",
};

export interface ContactRole {
  id?: string;
  contactId: string;
  dealId: string;
  role: string;
  createdAt?: string;
}

export function normaliseContactRole(raw: unknown): ContactRole | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = str(r.id);
  if (!id) return null;
  return {
    id,
    contactId: str(r.contactId),
    dealId: str(r.dealId),
    role: str(r.role),
    ...(optStr(r.createdAt) ? { createdAt: str(r.createdAt) } : {}),
  };
}

export function normaliseContactRoles(raw: unknown): ContactRole[] {
  return toArray(raw, "roles")
    .map(normaliseContactRole)
    .filter((r): r is ContactRole => r !== null);
}

export async function getContactRoles(contactId: string): Promise<LoaderResult<ContactRole[]>> {
  try {
    const res = await browserFetch(`v1/crm/contacts/${contactId}/roles`);
    if (!res.ok) return { data: [], source: "error" };
    return { data: normaliseContactRoles(await res.json()), source: "api" };
  } catch {
    return { data: [], source: "error" };
  }
}

export async function createContactRole(
  contactId: string,
  dealId: string,
  role: ContactRoleType,
): Promise<AcceptResult> {
  const res = await browserFetch(`v1/crm/contacts/${contactId}/roles`, {
    method: "POST",
    body: JSON.stringify({ dealId, role }),
  });
  if (!res.ok) throw new UserFacingError(await errorMessageFromResponse(res));
  return { accepted: res.status === 202 };
}

export async function deleteContactRole(contactId: string, roleId: string): Promise<void> {
  const res = await browserFetch(`v1/crm/contacts/${contactId}/roles/${roleId}`, { method: "DELETE" });
  if (!res.ok) throw new UserFacingError(await errorMessageFromResponse(res));
}

/* ============================================================ CM-002 ===== */

export const RELATIONSHIP_TYPES = ["parent", "subsidiary", "group", "branch", "partner", "affiliate"] as const;
export type RelationshipType = (typeof RELATIONSHIP_TYPES)[number];
export const RELATIONSHIP_TYPE_LABELS: Record<RelationshipType, string> = {
  parent: "Parent",
  subsidiary: "Subsidiary",
  group: "Group",
  branch: "Branch",
  partner: "Partner",
  affiliate: "Affiliate",
};

export interface AccountRelationship {
  id?: string;
  toAccountId: string;
  relType: RelationshipType;
  toAccountName?: string;
}

export function normaliseRelationship(raw: unknown): AccountRelationship | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const toAccountId = str(r.toAccountId);
  if (!toAccountId) return null;
  const rt = str(r.relType);
  return {
    ...(typeof r.id === "string" ? { id: r.id } : {}),
    toAccountId,
    relType: (RELATIONSHIP_TYPES as readonly string[]).includes(rt) ? (rt as RelationshipType) : "affiliate",
    ...(optStr(r.toAccountName) ? { toAccountName: str(r.toAccountName) } : {}),
  };
}

export function normaliseRelationships(raw: unknown): AccountRelationship[] {
  return toArray(raw, "relationships")
    .map(normaliseRelationship)
    .filter((r): r is AccountRelationship => r !== null);
}

export async function getAccountRelationships(accountId: string): Promise<LoaderResult<AccountRelationship[]>> {
  try {
    const res = await browserFetch(`v1/crm/accounts/${accountId}/relationships`);
    if (!res.ok) return { data: [], source: "error" };
    return { data: normaliseRelationships(await res.json()), source: "api" };
  } catch {
    return { data: [], source: "error" };
  }
}

export async function createAccountRelationship(
  accountId: string,
  toAccountId: string,
  relType: RelationshipType,
): Promise<void> {
  const res = await browserFetch(`v1/crm/accounts/${accountId}/relationships`, {
    method: "POST",
    body: JSON.stringify({ toAccountId, relType }),
  });
  if (!res.ok) throw new UserFacingError(await errorMessageFromResponse(res));
}

export async function deleteAccountRelationship(accountId: string, relId: string): Promise<void> {
  const res = await browserFetch(`v1/crm/accounts/${accountId}/relationships/${relId}`, { method: "DELETE" });
  if (!res.ok) throw new UserFacingError(await errorMessageFromResponse(res));
}

/* ============================================================ CM-004 ===== */

export interface Deal360 {
  id: string;
  name: string;
  stage: string;
  amount?: number;
}
export interface Quotation360 {
  id: string;
  reference: string;
  status: string;
  amount?: number;
}
export interface NextAction360 {
  id: string;
  title: string;
  dueAt?: string;
  status: string;
}
export interface Consent360 {
  marketing: boolean | null;
  updatedAt?: string;
  /** DPDP: what the consent was given for (marketing / transactional / service_updates / research). */
  purpose?: string;
  /** DPDP: the channel/source it was captured through (web_form / email / phone / in_person / import). */
  channel?: string;
}
/** Honest external stub: counts are null when the source isn't wired live. */
export interface External360 {
  caseCount: number | null;
  documentCount: number | null;
  source: string;
}

/** Block source: "crm" = a real, tenant-owned count (a 0 is a REAL zero, not a stub). */
export type Block360Source = "crm" | "error";

/**
 * BRD §9.4 — REAL communication counts, aggregated from the
 * crm.contact_communications projection the Communication Hub feeds. When
 * source==="crm" these are real tenant-owned numbers; a 0 is a genuine zero,
 * NOT an unsynced external stub.
 */
export interface Communications360 {
  total: number;
  delivered: number;
  failed: number;
  source: Block360Source;
}

/**
 * BRD §9.4 — REAL campaign-activity counts + server-attributed revenue.
 * `revenueMinor` is a minor-unit (paise) integer string — format via
 * formatMoney(), never parseFloat (paise-exact, no float drift).
 */
export interface CampaignActivity360 {
  responses: number;
  conversions: number;
  revenueMinor: string;
  source: Block360Source;
}

export interface Customer360 {
  activities: ActivityEntry[];
  /**
   * Live message / local-log items. On a CONTACT this is the cross-service
   * `communicationItems` section (notification/telephony, an { items } wrapper);
   * on an ACCOUNT it is the local `localCommunications` manual-log array. The
   * backend renamed its old `communications` array to these two names — the NEW
   * `communications` key is the counts block below (BRD §9.4).
   */
  communicationItems: CommunicationEntry[];
  /** REAL communication counts (source:"crm"), BRD §9.4. */
  communications: Communications360;
  /** REAL campaign-activity counts (source:"crm"), BRD §9.4. */
  campaignActivity: CampaignActivity360;
  deals: Deal360[];
  quotations: Quotation360[];
  nextActions: NextAction360[];
  roles: ContactRole[];
  addresses: Address[];
  consent: Consent360 | null;
  score: number | null;
  external: External360;
}

function normaliseDeals360(raw: unknown): Deal360[] {
  return toArray(raw)
    .map((item): Deal360 | null => {
      if (!item || typeof item !== "object") return null;
      const r = item as Record<string, unknown>;
      const id = str(r.id);
      if (!id) return null;
      const amount = numOrNull(r.amount);
      return {
        id,
        name: str(r.name) || str(r.dealName) || id,
        stage: str(r.stage),
        ...(amount !== null ? { amount } : {}),
      };
    })
    .filter((d): d is Deal360 => d !== null);
}

function normaliseQuotations360(raw: unknown): Quotation360[] {
  return toArray(raw)
    .map((item): Quotation360 | null => {
      if (!item || typeof item !== "object") return null;
      const r = item as Record<string, unknown>;
      const id = str(r.id);
      if (!id) return null;
      const amount = numOrNull(r.amount ?? r.total);
      return {
        id,
        reference: str(r.reference) || str(r.number) || id,
        status: str(r.status),
        ...(amount !== null ? { amount } : {}),
      };
    })
    .filter((q): q is Quotation360 => q !== null);
}

function normaliseNextActions360(raw: unknown): NextAction360[] {
  return toArray(raw)
    .map((item): NextAction360 | null => {
      if (!item || typeof item !== "object") return null;
      const r = item as Record<string, unknown>;
      const id = str(r.id);
      if (!id) return null;
      return {
        id,
        title: str(r.title) || str(r.subject) || str(r.text).slice(0, 80),
        status: str(r.status) || "open",
        ...(optStr(r.dueAt) ?? optStr(r.dueDate) ? { dueAt: str(r.dueAt ?? r.dueDate) } : {}),
      };
    })
    .filter((n): n is NextAction360 => n !== null);
}

function normaliseExternal360(raw: unknown): External360 {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  // The backend sends the NESTED shape `{ helpdeskCases: { count, source },
  // knowledgeDocuments: { count, source } }`. Read `.count` off each nested
  // block; a flat `caseCount`/`documentCount` is tolerated as a legacy fallback
  // so a non-null count renders the moment either source goes live.
  const nested = (v: unknown): unknown =>
    v && typeof v === "object" ? (v as Record<string, unknown>).count : undefined;
  const helpdesk = r.helpdeskCases;
  const knowledge = r.knowledgeDocuments;
  const src =
    (helpdesk && typeof helpdesk === "object" ? str((helpdesk as Record<string, unknown>).source) : "") ||
    str(r.source) ||
    "external";
  return {
    caseCount: numOrNull(nested(helpdesk) ?? r.caseCount),
    documentCount: numOrNull(nested(knowledge) ?? r.documentCount),
    source: src,
  };
}

/** A present-but-non-numeric count collapses to a real 0 (never NaN in the UI). */
function count0(v: unknown): number {
  return numOrNull(v) ?? 0;
}

/**
 * Parse the REAL communications counts block (BRD §9.4). A missing block, or one
 * whose source isn't "crm", is treated as unavailable (source:"error") — the UI
 * gates on that rather than showing a fabricated 0.
 */
export function normaliseCommunications360(raw: unknown): Communications360 {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    total: count0(r.total),
    delivered: count0(r.delivered),
    failed: count0(r.failed),
    source: r.source === "crm" ? "crm" : "error",
  };
}

/** Parse the REAL campaign-activity block (BRD §9.4). revenueMinor stays a paise string. */
export function normaliseCampaignActivity360(raw: unknown): CampaignActivity360 {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const rev =
    typeof r.revenueMinor === "string"
      ? r.revenueMinor.trim()
      : typeof r.revenueMinor === "number"
        ? String(r.revenueMinor)
        : "0";
  return {
    responses: count0(r.responses),
    conversions: count0(r.conversions),
    // Only trust a clean integer paise string; anything else is a real 0.
    revenueMinor: /^-?\d+$/.test(rev) ? rev : "0",
    source: r.source === "crm" ? "crm" : "error",
  };
}

export function normalise360(raw: unknown): Customer360 {
  const outer = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  // crm-service answers both 360 endpoints as `{ data: { ... } }`; reading the
  // top level of that envelope found no activities, deals, consent or score on a
  // live response. Unwrap it (a bare payload, as the unit fixtures use, still works).
  const r = (
    outer.data && typeof outer.data === "object" && !Array.isArray(outer.data) ? outer.data : outer
  ) as Record<string, unknown>;
  const consentRaw = r.consent && typeof r.consent === "object" ? (r.consent as Record<string, unknown>) : null;
  return {
    activities: normaliseActivities(r.activities),
    // Backend rename: the message/local-log item list is `communicationItems`
    // (contact, a cross-service { items } section) or `localCommunications`
    // (account, a bare array). Both flow through the same item normaliser.
    communicationItems: normaliseCommunications(r.communicationItems ?? r.localCommunications),
    // NEW real counts blocks (source:"crm"), BRD §9.4.
    communications: normaliseCommunications360(r.communications),
    campaignActivity: normaliseCampaignActivity360(r.campaignActivity),
    deals: normaliseDeals360(r.deals),
    quotations: normaliseQuotations360(r.quotations),
    nextActions: normaliseNextActions360(r.nextActions),
    roles: normaliseContactRoles(r.roles),
    addresses: normaliseAddresses(r.addresses),
    consent: consentRaw
      ? {
          // The contact 360 sends `marketingConsent` / `consentDate` (+ purpose,
          // channel, updatedAt); `marketing` / `updatedAt` are the older names.
          marketing:
            typeof consentRaw.marketing === "boolean"
              ? consentRaw.marketing
              : typeof consentRaw.marketingConsent === "boolean"
                ? consentRaw.marketingConsent
                : null,
          ...(optStr(consentRaw.updatedAt ?? consentRaw.consentDate)
            ? { updatedAt: str(consentRaw.updatedAt ?? consentRaw.consentDate) }
            : {}),
          ...(optStr(consentRaw.purpose) ? { purpose: str(consentRaw.purpose) } : {}),
          ...(optStr(consentRaw.channel) ? { channel: str(consentRaw.channel) } : {}),
        }
      : null,
    score: numOrNull(r.score),
    external: normaliseExternal360(r.external),
  };
}

export async function getContact360(id: string): Promise<LoaderResult<Customer360>> {
  try {
    const res = await browserFetch(`v1/crm/contacts/${id}/360`);
    if (!res.ok) return { data: normalise360(null), source: "error" };
    return { data: normalise360(await res.json()), source: "api" };
  } catch {
    return { data: normalise360(null), source: "error" };
  }
}

export async function getAccount360(id: string): Promise<LoaderResult<Customer360>> {
  try {
    const res = await browserFetch(`v1/crm/accounts/${id}/360`);
    if (!res.ok) return { data: normalise360(null), source: "error" };
    return { data: normalise360(await res.json()), source: "api" };
  } catch {
    return { data: normalise360(null), source: "error" };
  }
}

/* ============================================================ AC-004 ===== */

export const LINKED_PROVIDERS = ["google", "o365", "imap", "caldav"] as const;
export type LinkedProvider = (typeof LINKED_PROVIDERS)[number];
export const LINKED_PROVIDER_LABELS: Record<LinkedProvider, string> = {
  google: "Google (Gmail / Calendar)",
  o365: "Microsoft 365 (Outlook)",
  imap: "IMAP mailbox",
  caldav: "CalDAV calendar",
};

export type LinkedStatus = "pending" | "connected" | "error" | "revoked";

export interface LinkedAccount {
  id?: string;
  provider: LinkedProvider;
  externalEmail: string;
  status: LinkedStatus;
}

export function normaliseLinkedAccount(raw: unknown): LinkedAccount | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const p = str(r.provider);
  if (!(LINKED_PROVIDERS as readonly string[]).includes(p)) return null;
  const s = str(r.status);
  const status: LinkedStatus =
    s === "connected" || s === "error" || s === "revoked" ? (s as LinkedStatus) : "pending";
  return {
    ...(typeof r.id === "string" ? { id: r.id } : {}),
    provider: p as LinkedProvider,
    externalEmail: str(r.externalEmail),
    status,
  };
}

export function normaliseLinkedAccounts(raw: unknown): LinkedAccount[] {
  return toArray(raw, "accounts")
    .map(normaliseLinkedAccount)
    .filter((l): l is LinkedAccount => l !== null);
}

export async function getLinkedAccounts(): Promise<LoaderResult<LinkedAccount[]>> {
  try {
    const res = await browserFetch("v1/crm/linked-accounts");
    if (!res.ok) return { data: [], source: "error" };
    return { data: normaliseLinkedAccounts(await res.json()), source: "api" };
  } catch {
    return { data: [], source: "error" };
  }
}

export async function connectLinkedAccount(provider: LinkedProvider, externalEmail: string): Promise<void> {
  const res = await browserFetch("v1/crm/linked-accounts", {
    method: "POST",
    body: JSON.stringify({ provider, externalEmail, status: "pending" }),
  });
  if (!res.ok) throw new UserFacingError(await errorMessageFromResponse(res));
}

export async function deleteLinkedAccount(id: string): Promise<void> {
  const res = await browserFetch(`v1/crm/linked-accounts/${id}`, { method: "DELETE" });
  if (!res.ok) throw new UserFacingError(await errorMessageFromResponse(res));
}
