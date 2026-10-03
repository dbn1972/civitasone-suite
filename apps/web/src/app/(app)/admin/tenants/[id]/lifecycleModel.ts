import type { TenantApprovalPolicy, TenantApprovalPolicyView, TenantLifecycleRequest } from "@/app/_data/loaders";

/**
 * GAP-ADMIN-TENANTS-DETAIL-05: pure helpers for the tenant lifecycle UI.
 * Kept out of the components (and page.tsx) so the rules are unit tested and
 * the empty-vs-error guard never sees a bare `.length === 0` in a page file.
 */

export type PillTone = "good" | "warn" | "mut" | "bad" | "info";

export const TENANT_STATUS_KEYS = ["active", "suspended", "draft", "archived"] as const;
export type TenantStatusKey = (typeof TENANT_STATUS_KEYS)[number] | "unknown";

export function tenantStatusKey(status: string | undefined | null): TenantStatusKey {
  const s = (status ?? "").trim().toLowerCase();
  return (TENANT_STATUS_KEYS as readonly string[]).includes(s) ? (s as TenantStatusKey) : "unknown";
}

export function tenantStatusTone(status: string | undefined | null): PillTone {
  switch (tenantStatusKey(status)) {
    case "active": return "good";
    case "suspended": return "bad";
    case "draft":
    case "archived": return "mut";
    default: return "info";
  }
}

/** The stat tile's own tone vocabulary ("neutral" rather than "mut"). */
export function tenantStatCardTone(status: string | undefined | null): "good" | "bad" | "neutral" {
  const tone = tenantStatusTone(status);
  return tone === "good" ? "good" : tone === "bad" ? "bad" : "neutral";
}

export const REQUEST_STATUS_KEYS = ["pending", "scheduled", "executed", "rejected", "failed", "cancelled"] as const;
export type RequestStatusKey = (typeof REQUEST_STATUS_KEYS)[number] | "unknown";

export function requestStatusKey(status: string): RequestStatusKey {
  return (REQUEST_STATUS_KEYS as readonly string[]).includes(status) ? (status as RequestStatusKey) : "unknown";
}

export function requestTone(status: string): PillTone {
  switch (requestStatusKey(status)) {
    case "pending": return "warn";
    case "scheduled": return "info";
    case "executed": return "good";
    case "rejected":
    case "failed": return "bad";
    default: return "mut"; // includes "cancelled"
  }
}

export type KindKey = "suspend" | "reactivate" | "edit" | "policy_change" | "unknown";
export function kindKey(kind: string): KindKey {
  return kind === "suspend" || kind === "reactivate" || kind === "edit" || kind === "policy_change" ? kind : "unknown";
}

export function isOpen(r: Pick<TenantLifecycleRequest, "status">): boolean {
  return r.status === "pending" || r.status === "scheduled";
}

export function hasOpenRequest(requests: readonly TenantLifecycleRequest[], kind: string): boolean {
  return requests.some((r) => r.kind === kind && isOpen(r));
}

export function hasRequests(requests: readonly unknown[]): boolean {
  return requests.length > 0;
}

/** Which of the three actions the operator can start right now. */
export function availableActions(tenantStatus: string, requests: readonly TenantLifecycleRequest[]): {
  suspend: boolean; reactivate: boolean; edit: boolean;
} {
  const status = tenantStatusKey(tenantStatus);
  return {
    suspend: status === "active" && !hasOpenRequest(requests, "suspend"),
    reactivate: status === "suspended" && !hasOpenRequest(requests, "reactivate"),
    // Archived tenants are read-only.
    edit: status !== "archived" && status !== "unknown" && !hasOpenRequest(requests, "edit"),
  };
}

export function hasAnyAction(a: { suspend: boolean; reactivate: boolean; edit: boolean }): boolean {
  return a.suspend || a.reactivate || a.edit;
}

export function listSignature(requests: readonly TenantLifecycleRequest[]): string {
  return requests.map((r) => `${r.id}:${r.status}:${r.approvalsCount}`).join("|");
}

/** The error-code -> catalogued-message key. Anything unknown is generic, never the server's own text. */
const KNOWN_ERROR_CODES = new Set([
  "MAKER_CHECKER_VIOLATION", "NOT_AN_APPROVER", "TENANT_SELF_ACTION_FORBIDDEN", "REQUEST_ALREADY_OPEN",
  "REQUEST_NOT_PENDING", "NOT_SCHEDULED", "NOT_PARTY_TO_REQUEST", "INVALID_TRANSITION", "REASON_REQUIRED", "NOT_FOUND",
]);
export function knownErrorCode(code: string | undefined | null): string | null {
  return code && KNOWN_ERROR_CODES.has(code) ? code : null;
}

const KNOWN_FAILURES = new Set(["INVALID_TRANSITION", "TENANT_SELF_ACTION_FORBIDDEN", "NOT_AN_APPROVER", "REASON_REQUIRED", "EXECUTION_FAILED", "NO_CHANGE"]);
export function failureKey(code: string | null | undefined): string {
  return code && KNOWN_FAILURES.has(code) ? code : "default";
}

// ── edit form ────────────────────────────────────────────────────────────────

export type EditForm = { name: string; domain: string; edition: string };
export type EditChanges = Partial<EditForm>;
export type EditCheck =
  | { ok: true; changes: EditChanges }
  | { ok: false; error: "noChange" | "name" | "domain" };

const DOMAIN_RE = /^[a-z0-9.-]+$/i;

export function checkEditForm(next: EditForm, current: EditForm): EditCheck {
  const changes: EditChanges = {};
  const name = next.name.trim();
  const domain = next.domain.trim();
  if (name !== current.name) {
    if (name.length < 2 || name.length > 200) return { ok: false, error: "name" };
    changes.name = name;
  }
  if (domain !== current.domain) {
    if (domain.length < 3 || domain.length > 253 || !DOMAIN_RE.test(domain)) return { ok: false, error: "domain" };
    changes.domain = domain;
  }
  if (next.edition !== current.edition) changes.edition = next.edition;
  return Object.keys(changes).length === 0 ? { ok: false, error: "noChange" } : { ok: true, changes };
}

export function describeChanges(payload: Record<string, unknown>): string {
  return ["name", "domain", "edition"]
    .filter((k) => typeof payload[k] === "string")
    .map((k) => `${k}: ${String(payload[k])}`)
    .join(", ");
}

// ── policy ───────────────────────────────────────────────────────────────────

export const APPROVER_ROLE_OPTIONS = ["super_admin", "platform_admin"] as const;

export const FALLBACK_POLICY: TenantApprovalPolicy = {
  requiresSecondApprover: true,
  approverRoles: [...APPROVER_ROLE_OPTIONS],
  minApprovals: 1,
  reasonRequired: true,
  notifyTenantAdmins: true,
};

/** A tolerant read of whatever the API returned; the strict default when it is not a usable policy. */
export function normalizePolicy(view: TenantApprovalPolicyView | null | undefined): TenantApprovalPolicy {
  const p = view?.policy;
  if (!p || typeof p !== "object") return { ...FALLBACK_POLICY, approverRoles: [...FALLBACK_POLICY.approverRoles] };
  const roles = Array.isArray(p.approverRoles) ? p.approverRoles.filter((r): r is string => typeof r === "string") : [];
  return {
    requiresSecondApprover: p.requiresSecondApprover !== false,
    approverRoles: roles.length > 0 ? roles : [...FALLBACK_POLICY.approverRoles],
    minApprovals: Number.isInteger(p.minApprovals) && p.minApprovals >= 1 ? p.minApprovals : 1,
    reasonRequired: p.reasonRequired !== false,
    notifyTenantAdmins: p.notifyTenantAdmins !== false,
  };
}

export function policiesEqual(a: TenantApprovalPolicy, b: TenantApprovalPolicy): boolean {
  return a.requiresSecondApprover === b.requiresSecondApprover
    && a.minApprovals === b.minApprovals
    && a.reasonRequired === b.reasonRequired
    && a.notifyTenantAdmins === b.notifyTenantAdmins
    && [...a.approverRoles].sort().join(",") === [...b.approverRoles].sort().join(",");
}

export type PolicyCheck = { ok: true } | { ok: false; error: "roles" | "noChange" };
export function checkPolicyForm(next: TenantApprovalPolicy, current: TenantApprovalPolicy): PolicyCheck {
  if (next.approverRoles.length < 1) return { ok: false, error: "roles" };
  return policiesEqual(next, current) ? { ok: false, error: "noChange" } : { ok: true };
}

export function toggleRole(roles: readonly string[], role: string): string[] {
  return roles.includes(role) ? roles.filter((r) => r !== role) : [...roles, role];
}

/** True when the policy lets the operator act without a second approver. */
export function actsDirectly(policy: TenantApprovalPolicy): boolean {
  return !policy.requiresSecondApprover;
}

export function pendingPolicyOf(requests: readonly TenantLifecycleRequest[], view: TenantApprovalPolicyView | null | undefined): TenantLifecycleRequest | null {
  return view?.pendingChange ?? requests.find((r) => r.kind === "policy_change" && isOpen(r)) ?? null;
}

/** Datetime-local value ("2026-10-03T14:30") to an ISO instant, or null when blank/invalid. */
export function toIsoOrNull(local: string): string | null {
  if (!local) return null;
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
