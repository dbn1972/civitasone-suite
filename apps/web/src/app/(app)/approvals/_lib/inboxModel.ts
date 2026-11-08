/**
 * UX R1 (approvals inbox -> decide): the client-safe model behind the unified inbox.
 * Pure functions only (no next/headers), so the server page, the client inbox, the decision panel
 * and the tests share one definition of: which module a task belongs to, what a row is called,
 * how overdue it is, and how filters apply.
 *
 * Trust rule (report section 3, issue 2): nothing here ever returns an internal id, a role code,
 * "Unknown officer" or a {{placeholder}}. When a fact is missing the caller shows a localised
 * "not recorded" text instead.
 */

export type InboxTab = "waiting" | "sent" | "done";
export const INBOX_TABS: readonly InboxTab[] = ["waiting", "sent", "done"];

export type Person = { name: string; designation: string | null };

/** One task row of GET /v1/workflow/inbox. */
export type InboxTask = {
  id: string;
  instanceId: string;
  name: string;
  status: string;
  decision?: string | null;
  refType?: string | null;
  refId?: string | null;
  dueAt?: string | null;
  createdAt?: string | null;
  completedAt?: string | null;
  instanceName?: string | null;
  /** When the item was raised (instance creation), not when the current step opened. */
  raisedAt?: string | null;
};

export type InboxCounts = { waiting: number; overdue: number; sent: number; done: number };

/** One entry of POST /v1/workflow/ref-summaries. */
export type RefSummary = {
  refType: string;
  refId: string;
  kind: "business" | "generic";
  instanceId: string;
  instanceName: string;
  reference: string | null;
  amountMinor: string | null;
  fields: Array<{ key: string; value: string }>;
  maker: Person | null;
  stage: { level: number; of: number | null; step: string | null };
  raisedAt?: string | null;
  parentId?: string;
};

/** Business modules an approver filters by. Keys are message keys under approvalsInbox.modules. */
export const MODULES = ["procurement", "leave", "payroll", "finance", "estab", "other"] as const;
export type ModuleKey = (typeof MODULES)[number];

/** Known business types (message keys under approvalsInbox.types). */
export const TYPE_BY_REF: Readonly<Record<string, string>> = {
  procurement_indent: "indent",
  procurement_po: "purchaseOrder",
  procurement_po_amendment: "poAmendment",
  procurement_plan: "procurementPlan",
  leave_app: "leave",
  payroll_run: "payrollRun",
  finance_bill: "bill",
  estab_file: "file",
};
export const TYPE_KEYS = ["indent", "purchaseOrder", "poAmendment", "procurementPlan", "leave", "payrollRun", "bill", "file", "other"] as const;
export type TypeKey = (typeof TYPE_KEYS)[number];

export function typeOf(refType: string | null | undefined): TypeKey {
  return ((refType && TYPE_BY_REF[refType]) || "other") as TypeKey;
}

export function moduleOf(refType: string | null | undefined): ModuleKey {
  const r = refType ?? "";
  if (r.startsWith("procurement_")) return "procurement";
  if (r === "leave_app" || r.startsWith("leave_")) return "leave";
  if (r.startsWith("payroll_")) return "payroll";
  if (r.startsWith("finance_")) return "finance";
  if (r.startsWith("estab_")) return "estab";
  return "other";
}

/** refTypes a module filter narrows to on the server (?refType=), when the module is known. */
export const MODULE_REF_TYPES: Readonly<Record<Exclude<ModuleKey, "other">, readonly string[]>> = {
  procurement: ["procurement_indent", "procurement_po", "procurement_po_amendment", "procurement_plan"],
  leave: ["leave_app"],
  payroll: ["payroll_run"],
  finance: ["finance_bill"],
  estab: ["estab_file"],
};

export function isModuleKey(v: unknown): v is ModuleKey {
  return typeof v === "string" && (MODULES as readonly string[]).includes(v);
}

const UUID_ANYWHERE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const PLACEHOLDER = /\{\{[^}]*\}\}/;

/** Role codes the platform issues; a system field that is exactly one of these is a leak. */
export const KNOWN_ROLE_CODES: ReadonlySet<string> = new Set([
  "super_admin", "tenant_admin", "platform_admin", "service_account", "default-roles-civitasone",
  "workflow_user", "workflow_admin", "manager", "officer", "employee", "dept_head", "auditor", "audit_officer",
  "hr_admin", "hr_staff", "hr_officer", "payroll_admin", "finance_admin", "finance_staff", "finance_officer",
  "accounts_officer", "procurement_admin", "procurement_officer", "proc_head",
  "estab_officer", "estab_admin", "estab_section_officer", "estab_under_secretary", "estab_deputy_secretary",
]);

/**
 * For SYSTEM-generated display fields only (actor names, designations, step and instance names):
 * null when the value is a genuine UUID (8-4-4-4-12) or contains one, is exactly a known role
 * code, is a {{placeholder}}, or says "Unknown ...". Never used for officer remarks, business
 * references or module facts: those are shown as entered (React escapes them), so "Sanction
 * 12345678 attached" and IND/20261104 are never hidden (PR #2460 review, blocker 1).
 */
export function presentable(text: string | null | undefined): string | null {
  const t = (text ?? "").trim();
  if (!t) return null;
  if (UUID_ANYWHERE.test(t) || PLACEHOLDER.test(t) || KNOWN_ROLE_CODES.has(t)) return null;
  if (/^unknown\b/i.test(t)) return null;
  return t;
}

/** Business text (references, module facts): shown as given, only trimmed; empty is null. */
export function asGiven(text: string | null | undefined): string | null {
  const t = (text ?? "").trim();
  return t ? t : null;
}

/** "Anita Verma, Section Officer" / "Anita Verma" / null. */
export function personLabel(p: Person | null | undefined): string | null {
  const name = presentable(p?.name);
  if (!name) return null;
  const des = presentable(p?.designation);
  return des ? `${name}, ${des}` : name;
}

export type SlaState = "overdue" | "dueToday" | "dueSoon" | "onTrack" | "farDate" | "none";

/** Same rule as workflow-service PLAUSIBLE_DUE_DAYS: a due date further away is shown as a plain date. */
export const PLAUSIBLE_DUE_DAYS = 365;

const DAY = 86_400_000;

/** IST calendar day number of an instant (so "due today" means today in India, not UTC). */
function istDay(ms: number): number {
  return Math.floor((ms + 5.5 * 3_600_000) / DAY);
}

export function slaOf(dueAt: string | null | undefined, now: number): { state: SlaState; days: number } {
  if (!dueAt) return { state: "none", days: 0 };
  const due = new Date(dueAt).getTime();
  if (!Number.isFinite(due)) return { state: "none", days: 0 };
  const dayDiff = istDay(due) - istDay(now);
  // A due date more than a year away either way (a bad default, an old fixture) is not an SLA:
  // never "Overdue by 2,485 days", just the date.
  if (Math.abs(dayDiff) > PLAUSIBLE_DUE_DAYS) return { state: "farDate", days: 0 };
  if (due < now) return { state: "overdue", days: Math.max(1, istDay(now) - istDay(due)) };
  if (dayDiff === 0) return { state: "dueToday", days: 0 };
  if (dayDiff <= 2) return { state: "dueSoon", days: dayDiff };
  return { state: "onTrack", days: dayDiff };
}

/** Whole days since `iso` (0 = today). */
export function ageDays(iso: string | null | undefined, now: number): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.max(0, istDay(now) - istDay(t));
}

export type InboxRow = {
  task: InboxTask;
  summary: RefSummary | null;
  module: ModuleKey;
  type: TypeKey;
  reference: string | null;
  amountMinor: string | null;
  maker: Person | null;
  sla: { state: SlaState; days: number };
  age: number | null;
};

export function buildRows(tasks: readonly InboxTask[], summaries: readonly RefSummary[], now: number): InboxRow[] {
  const byRef = new Map(summaries.map((s) => [`${s.refType}:${s.refId}`, s]));
  return tasks.map((task) => {
    const summary = task.refType && task.refId ? byRef.get(`${task.refType}:${task.refId}`) ?? null : null;
    return {
      task,
      summary,
      module: moduleOf(task.refType),
      type: typeOf(task.refType),
      reference: asGiven(summary?.reference),
      amountMinor: summary?.amountMinor ?? null,
      maker: summary?.maker ?? null,
      sla: slaOf(task.dueAt, now),
      age: ageDays(task.raisedAt ?? summary?.raisedAt ?? task.createdAt, now),
    };
  });
}

export type InboxFilters = {
  module: ModuleKey | "all";
  type: TypeKey | "all";
  sla: "all" | "overdue" | "dueToday" | "dueSoon";
  /** Rupees (not paise); empty = no bound. */
  minAmount: string;
  maxAmount: string;
  q: string;
};

export const NO_FILTERS: InboxFilters = { module: "all", type: "all", sla: "all", minAmount: "", maxAmount: "", q: "" };

function rupeesToMinor(v: string): bigint | null {
  const t = v.replace(/[,\s₹]/g, "");
  if (!t || !/^\d+(\.\d{0,2})?$/.test(t)) return null;
  const [whole, frac = ""] = t.split(".");
  return BigInt(whole!) * 100n + BigInt((frac + "00").slice(0, 2));
}

/** The search text a row matches on: reference, title text, maker name. */
export function searchText(row: InboxRow): string {
  return [row.reference, presentable(row.summary?.instanceName ?? row.task.instanceName), personLabel(row.maker), ...(row.summary?.fields ?? []).map((f) => f.value)]
    .filter(Boolean).join(" ").toLowerCase();
}

export function applyFilters(rows: readonly InboxRow[], f: InboxFilters): InboxRow[] {
  const min = rupeesToMinor(f.minAmount);
  const max = rupeesToMinor(f.maxAmount);
  const q = f.q.trim().toLowerCase();
  return rows.filter((r) => {
    if (f.module !== "all" && r.module !== f.module) return false;
    if (f.type !== "all" && r.type !== f.type) return false;
    if (f.sla === "overdue" && r.sla.state !== "overdue") return false;
    if (f.sla === "dueToday" && r.sla.state !== "dueToday") return false;
    if (f.sla === "dueSoon" && r.sla.state !== "dueSoon" && r.sla.state !== "dueToday") return false;
    if (min !== null || max !== null) {
      if (r.amountMinor === null || !/^-?\d+$/.test(r.amountMinor)) return false;
      const a = BigInt(r.amountMinor);
      const abs = a < 0n ? -a : a;
      if (min !== null && abs < min) return false;
      if (max !== null && abs > max) return false;
    }
    if (q && !searchText(r).includes(q)) return false;
    return true;
  });
}

const SLA_RANK: Record<SlaState, number> = { overdue: 0, dueToday: 1, dueSoon: 2, onTrack: 3, farDate: 4, none: 4 };

/** Overdue first (most overdue first), then due today, due soon, the rest by age (oldest first). */
export function sortRows(rows: readonly InboxRow[], tab: InboxTab): InboxRow[] {
  if (tab === "done") return [...rows];
  return [...rows].sort((a, b) => {
    const r = SLA_RANK[a.sla.state] - SLA_RANK[b.sla.state];
    if (r !== 0) return r;
    if (a.sla.state === "overdue") return b.sla.days - a.sla.days;
    return (b.age ?? -1) - (a.age ?? -1);
  });
}

/** The detail route for a business record (existing app routes only), or null. */
export function recordHref(refType: string | null | undefined, refId: string | null | undefined, parentId?: string): string | null {
  if (!refType || !refId) return null;
  switch (refType) {
    case "procurement_indent": return `/procurement/indents/${refId}`;
    case "procurement_po": return `/procurement/orders/${refId}`;
    case "procurement_po_amendment": return parentId ? `/procurement/orders/${parentId}` : null;
    case "finance_bill": return `/finance/expenditure/bills/${refId}`;
    case "estab_file": return `/estab/files/${refId}`;
    case "payroll_run": return `/hr/payroll/${refId}`;
    default: return null;
  }
}

/** Window event the inbox fires with fresh counts; the sidebar badge listens to it. */
export const COUNTS_EVENT = "civitas:approvals-counts";
