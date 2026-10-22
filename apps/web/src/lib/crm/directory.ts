/**
 * The CRM staff directory as the web reads it: ONE shape and ONE parser for the role and
 * user pickers of both escalation editors.
 *
 * crm-service serves a single tenant directory (shared/user-directory.ts): the tenant's
 * ACTIVE roles as { key, label } and ACTIVE users as { id, name }. The task-escalation
 * editor reads it from GET /v1/crm/directory/{roles,users} (activityAccount.ts) and the
 * lead-escalation editor from GET /v1/crm/escalation-rules/recipients (assignment.ts);
 * they used to keep two copies of these types and parsers.
 *
 * Kept free of imports so both of those modules can use it without a cycle.
 */

/** A selectable role (key = the role name an escalation rule stores). */
export interface EscalationRole {
  key: string;
  label: string;
}

/** A selectable ACTIVE user (the id is stored; the name is shown). */
export interface EscalationUser {
  id: string;
  name: string;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/** A bare array, or an { items | data | <key> } wrapper around one; anything else is empty. */
function rowsOf(raw: unknown, key: string): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object") {
    for (const k of ["items", "data", key]) {
      const v = (raw as Record<string, unknown>)[k];
      if (Array.isArray(v)) return v;
    }
  }
  return [];
}

export function normaliseEscalationRoles(raw: unknown): EscalationRole[] {
  const out: EscalationRole[] = [];
  for (const item of rowsOf(raw, "roles")) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const key = str(r.key) || str(r.name) || str(r.id);
    if (!key) continue;
    out.push({ key, label: str(r.label) || str(r.name) || key });
  }
  return out;
}

export function normaliseEscalationUsers(raw: unknown): EscalationUser[] {
  const out: EscalationUser[] = [];
  for (const item of rowsOf(raw, "users")) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const id = str(r.id);
    if (!id) continue;
    out.push({ id, name: str(r.name) || str(r.email) || id });
  }
  return out;
}
