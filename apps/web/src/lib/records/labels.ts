/**
 * UX-R5 (names, not ids): the ONE place a record screen turns a resolved reference into display text.
 * Pure and client-safe (no fetch): the server resolver (recordRefs.ts) fills the maps, pages and client
 * components format with these helpers.
 *
 * Rules (redesign R5, GLB-07/09):
 *   - a person reads "Name, Designation" (or just "Name" when no designation is on record);
 *   - an id the directory could not resolve reads "Name not available (ID ending 0d88)", never a guessed name,
 *     never a full UUID and never "Unknown officer";
 *   - a role/step code reads as a label ("Head of Procurement"), never "proc_head";
 *   - Keycloak plumbing roles (default-roles-*, offline_access, uma_authorization) are never shown.
 */

export type PersonRef = { name: string; designation: string | null };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Server-sent placeholder names that mean "not resolved"; treated exactly like a missing name. */
const PLACEHOLDER_NAMES = new Set(["unknown officer", "unknown vendor", "unknown user", "unknown", "system", "-", "—", ""]);

export function isUuid(value: string | null | undefined): value is string {
  return typeof value === "string" && UUID_RE.test(value.trim());
}

/** True for a usable human name (not a placeholder, not an id). */
export function isRealName(value: string | null | undefined): value is string {
  if (typeof value !== "string") return false;
  const v = value.trim();
  if (PLACEHOLDER_NAMES.has(v.toLowerCase())) return false;
  if (isUuid(v)) return false;
  // "Unknown officer (1a2b3c4d)" / a bare 8-hex fragment are placeholders too.
  if (/^unknown\b/i.test(v) || /^[0-9a-f]{8}(…|\.\.\.)?$/i.test(v)) return false;
  return true;
}

/** The last four characters of an id, for the honest unresolved label. */
export function idTail(id: string): string {
  const compact = id.replace(/-/g, "");
  return compact.slice(-4);
}

/** "Name not available (ID ending 0d88)" -- the only text an unresolved person or record ever renders. */
export function unresolvedLabel(id: string | null | undefined): string {
  const v = (id ?? "").trim();
  if (!v) return "—";
  return `Name not available (ID ending ${idTail(v)})`;
}

/** "Asha Rao, Section Officer" / "Asha Rao". */
export function formatPerson(ref: PersonRef): string {
  const d = ref.designation?.trim();
  return d ? `${ref.name}, ${d}` : ref.name;
}

/**
 * The label for a person reference. Looks the id up in the resolved map first; then accepts a name the
 * source service already sent (when it is a real name, not a placeholder); otherwise the honest unresolved
 * label. An empty id with no name renders "—".
 */
export function personLabel(
  people: ReadonlyMap<string, PersonRef> | undefined,
  id: string | null | undefined,
  sentName?: string | null,
): string {
  const key = (id ?? "").trim();
  const hit = key ? people?.get(key) : undefined;
  if (hit) return formatPerson(hit);
  if (isRealName(sentName)) return sentName.trim();
  // A source that sent the UUID itself as the "name".
  if (!key && isUuid(sentName)) return unresolvedLabel(sentName);
  return key ? unresolvedLabel(key) : "—";
}

/** The label for a vendor / named-record reference: resolved name, else a real sent name, else unresolved. */
export function nameLabel(
  names: ReadonlyMap<string, string> | undefined,
  id: string | null | undefined,
  sentName?: string | null,
): string {
  const key = (id ?? "").trim();
  const hit = key ? names?.get(key) : undefined;
  if (hit && isRealName(hit)) return hit;
  if (isRealName(sentName)) return sentName.trim();
  if (!key && isUuid(sentName)) return unresolvedLabel(sentName);
  return key ? unresolvedLabel(key) : "—";
}

/**
 * Role / workflow-step codes as officers read them. Anything not listed falls back to a sentence-cased
 * rendering of the code ("records_clerk" -> "Records clerk"); Keycloak plumbing roles map to null (hidden).
 */
export const ROLE_LABELS: Readonly<Record<string, string>> = {
  super_admin: "Platform administrator",
  tenant_admin: "Department administrator",
  admin: "Administrator",
  proc_head: "Head of Procurement",
  procurement_head: "Head of Procurement",
  procurement_admin: "Procurement administrator",
  procurement_officer: "Procurement officer",
  store_keeper: "Store keeper",
  storekeeper: "Store keeper",
  finance_admin: "Finance administrator",
  finance_officer: "Finance officer",
  accounts_officer: "Accounts Officer",
  ddo: "Drawing and Disbursing Officer (DDO)",
  hod: "Head of Department",
  head_of_department: "Head of Department",
  hr_admin: "HR administrator",
  hr_officer: "HR officer",
  hr_manager: "HR manager",
  payroll_admin: "Payroll administrator",
  payroll_officer: "Payroll officer",
  manager: "Reporting officer",
  manager_approval: "Reporting officer approval",
  reporting_officer: "Reporting officer",
  reviewing_officer: "Reviewing officer",
  accepting_authority: "Accepting authority",
  disciplinary_authority: "Disciplinary authority",
  inquiry_officer: "Inquiry officer",
  presenting_officer: "Presenting officer",
  estab_officer: "Establishment officer",
  section_officer: "Section Officer",
  under_secretary: "Under Secretary",
  deputy_secretary: "Deputy Secretary",
  joint_secretary: "Joint Secretary",
  secretary: "Secretary",
  asset_manager: "Asset manager",
  contract_manager: "Contract manager",
  legal_officer: "Legal officer",
  audit_officer: "Audit officer",
  auditor: "Auditor",
  employee: "Employee",
  service_account: "System",
  meeting_secretary: "Meeting secretary",
  chairperson: "Chairperson",
  start: "Submitted",
};

const HIDDEN_ROLE_RE = /^(default-roles-.*|offline_access|uma_authorization)$/i;

/** Display label for a role / workflow-step code; null for roles that must never be shown. */
export function roleLabel(code: string | null | undefined): string | null {
  const raw = (code ?? "").trim();
  if (!raw) return null;
  if (HIDDEN_ROLE_RE.test(raw)) return null;
  const key = raw.toLowerCase();
  const known = ROLE_LABELS[key];
  if (known) return known;
  const words = key.split(/[\s_.-]+/).filter(Boolean);
  if (words.length === 0) return null;
  words[0] = words[0]!.charAt(0).toUpperCase() + words[0]!.slice(1);
  return words.join(" ");
}

/** Readable labels for a role list, plumbing roles dropped, duplicates removed, order kept. */
export function roleLabels(codes: ReadonlyArray<string | null | undefined>): string[] {
  const out: string[] = [];
  for (const c of codes) {
    const l = roleLabel(c);
    if (l && !out.includes(l)) out.push(l);
  }
  return out;
}
