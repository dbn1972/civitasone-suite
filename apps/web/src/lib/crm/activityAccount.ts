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
import { browserFetch, errorMessageFromResponse } from "@/lib/api/browserClient";
import { minutesSince, formatAgeing } from "@/lib/crm/assignment";

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
  if (!res.ok) throw new Error(await errorMessageFromResponse(res));
  return { accepted: res.status === 202 };
}

/* ============================================================ AC-005 ===== */

export interface TaskEscalationRule {
  id?: string;
  /** Escalate a task overdue by more than this many minutes. */
  thresholdMinutes: number;
  /** Escalate to a manager role OR a specific manager — one is used. */
  managerRole: string;
  managerId: string;
  enabled: boolean;
}

export function normaliseTaskEscalationRule(raw: unknown): TaskEscalationRule | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const threshold = numOrNull(r.thresholdMinutes);
  return {
    ...(typeof r.id === "string" ? { id: r.id } : {}),
    thresholdMinutes: threshold ?? 0,
    managerRole: str(r.managerRole),
    managerId: str(r.managerId),
    enabled: bool(r.enabled, true),
  };
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

export async function createTaskEscalationRule(rule: TaskEscalationRule): Promise<void> {
  const res = await browserFetch("v1/crm/task-escalation-rules", {
    method: "POST",
    body: JSON.stringify(rule),
  });
  if (!res.ok) throw new Error(await errorMessageFromResponse(res));
}

export async function updateTaskEscalationRule(id: string, rule: TaskEscalationRule): Promise<void> {
  const res = await browserFetch(`v1/crm/task-escalation-rules/${id}`, {
    method: "PUT",
    body: JSON.stringify(rule),
  });
  if (!res.ok) throw new Error(await errorMessageFromResponse(res));
}

export async function deleteTaskEscalationRule(id: string): Promise<void> {
  const res = await browserFetch(`v1/crm/task-escalation-rules/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(await errorMessageFromResponse(res));
}

export interface OverdueTask {
  id: string;
  subject: string;
  dueAt: string;
  ageMinutes: number;
  owner?: string;
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
    out.push({
      id,
      subject: str(r.subject) || str(r.text).slice(0, 80),
      dueAt,
      ageMinutes: minutesSince(dueAt, now),
      ...(optStr(r.owner ?? r.actorName ?? r.ownerId) ? { owner: str(r.owner ?? r.actorName ?? r.ownerId) } : {}),
      ...(optStr(r.subjectType) ? { subjectType: str(r.subjectType) } : {}),
      ...(optStr(r.subjectId) ? { subjectId: str(r.subjectId) } : {}),
    });
  }
  return out.sort((a, b) => b.ageMinutes - a.ageMinutes);
}

export async function getOverdueTasks(): Promise<LoaderResult<OverdueTask[]>> {
  try {
    const res = await browserFetch("v1/crm/activities?type=task&status=open&overdue=true");
    if (!res.ok) return { data: [], source: "error" };
    return { data: normaliseOverdueTasks(await res.json()), source: "api" };
  } catch {
    return { data: [], source: "error" };
  }
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
    occurredAt: str(r.occurredAt) || str(r.createdAt),
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
  if (!res.ok) throw new Error(await errorMessageFromResponse(res));
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
  if (!res.ok) throw new Error(await errorMessageFromResponse(res));
}

export async function updateAddress(id: string, body: Address): Promise<void> {
  const res = await browserFetch(`v1/crm/addresses/${id}`, { method: "PUT", body: JSON.stringify(body) });
  if (!res.ok) throw new Error(await errorMessageFromResponse(res));
}

export async function deleteAddress(id: string): Promise<void> {
  const res = await browserFetch(`v1/crm/addresses/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(await errorMessageFromResponse(res));
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
  if (!res.ok) throw new Error(await errorMessageFromResponse(res));
  return { accepted: res.status === 202 };
}

export async function deleteContactRole(contactId: string, roleId: string): Promise<void> {
  const res = await browserFetch(`v1/crm/contacts/${contactId}/roles/${roleId}`, { method: "DELETE" });
  if (!res.ok) throw new Error(await errorMessageFromResponse(res));
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
  if (!res.ok) throw new Error(await errorMessageFromResponse(res));
}

export async function deleteAccountRelationship(accountId: string, relId: string): Promise<void> {
  const res = await browserFetch(`v1/crm/accounts/${accountId}/relationships/${relId}`, { method: "DELETE" });
  if (!res.ok) throw new Error(await errorMessageFromResponse(res));
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
}
/** Honest external stub: counts are null when the source isn't wired live. */
export interface External360 {
  caseCount: number | null;
  documentCount: number | null;
  source: string;
}

export interface Customer360 {
  activities: ActivityEntry[];
  communications: CommunicationEntry[];
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
  return {
    caseCount: numOrNull(r.caseCount),
    documentCount: numOrNull(r.documentCount),
    source: str(r.source) || "external",
  };
}

export function normalise360(raw: unknown): Customer360 {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const consentRaw = r.consent && typeof r.consent === "object" ? (r.consent as Record<string, unknown>) : null;
  return {
    activities: normaliseActivities(r.activities),
    communications: normaliseCommunications(r.communications),
    deals: normaliseDeals360(r.deals),
    quotations: normaliseQuotations360(r.quotations),
    nextActions: normaliseNextActions360(r.nextActions),
    roles: normaliseContactRoles(r.roles),
    addresses: normaliseAddresses(r.addresses),
    consent: consentRaw
      ? {
          marketing: typeof consentRaw.marketing === "boolean" ? consentRaw.marketing : null,
          ...(optStr(consentRaw.updatedAt) ? { updatedAt: str(consentRaw.updatedAt) } : {}),
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
  if (!res.ok) throw new Error(await errorMessageFromResponse(res));
}

export async function deleteLinkedAccount(id: string): Promise<void> {
  const res = await browserFetch(`v1/crm/linked-accounts/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(await errorMessageFromResponse(res));
}
