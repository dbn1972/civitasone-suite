import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE } from "./config";
import { BILLING_INVOICE_READER_ROLES } from "./adminRoles";

interface JwtPayload {
  sub?: string;
  tid?: string;
  roles?: string[];
  exp?: number;
  name?: string;
  email?: string;
}

function decodeJwtPayload(token: string): JwtPayload {
  try {
    const parts = token.split(".");
    if (parts.length < 2) return {};
    const raw = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = raw + "=".repeat((4 - (raw.length % 4)) % 4);
    return JSON.parse(Buffer.from(padded, "base64").toString("utf8")) as JwtPayload;
  } catch {
    return {};
  }
}

export function getSessionRoles(): string[] {
  const token = cookies().get(COOKIE.ACCESS)?.value;
  if (!token) return [];
  const payload = decodeJwtPayload(token);
  return Array.isArray(payload.roles) ? payload.roles : [];
}

/** The current office (tenant) id from the session, or null when not signed in. */
export function getSessionTenantId(): string | null {
  const token = cookies().get(COOKIE.ACCESS)?.value;
  if (!token) return null;
  const payload = decodeJwtPayload(token);
  return typeof payload.tid === "string" && payload.tid.length > 0 ? payload.tid : null;
}

/** Display name from the session token, or null when not signed in. */
export function getSessionName(): string | null {
  const token = cookies().get(COOKIE.ACCESS)?.value;
  if (!token) return null;
  const payload = decodeJwtPayload(token);
  return typeof payload.name === "string" && payload.name.length > 0 ? payload.name : null;
}

/**
 * The signed-in user's id (JWT `sub`) -- the same value services see as
 * ctx.actorId and stamp into created_by. Used for UI-side maker-checker
 * hints (e.g. GAP-PAYROLL-LOANS-02: hide Disburse on a loan you created);
 * the server remains the authority. Null when not signed in.
 */
export function getSessionUserId(): string | null {
  const token = cookies().get(COOKIE.ACCESS)?.value;
  if (!token) return null;
  const payload = decodeJwtPayload(token);
  return typeof payload.sub === "string" && payload.sub.length > 0 ? payload.sub : null;
}

export function requireAnyRole(allowed: string[], redirectTo = "/dashboard"): void {
  const sessionRoles = getSessionRoles();
  const hasRole = allowed.some((r) => sessionRoles.includes(r));
  if (!hasRole) redirect(redirectTo);
}

/**
 * Roles permitted to create/approve/disburse/revert payroll runs. Mirrors
 * payroll-service's PAYROLL_ROLES (routes.ts) -- single source of truth for
 * every payroll page's admin-only gating (previously duplicated ad hoc per
 * file; see GAP-PAYROLL-RUNS-03).
 */
export const PAYROLL_ADMIN_ROLES = ["payroll_admin", "payroll_officer", "super_admin"];

/**
 * Roles permitted to read payroll run data (list/detail). Mirrors
 * payroll-service's READER_ROLES (routes.ts): PAYROLL_ADMIN_ROLES plus
 * hr_admin/finance_officer -- deliberately NOT "employee" or "manager",
 * which hr/layout.tsx otherwise admits to every /hr/payroll* route. A role
 * outside this list gets a 403 from the API today regardless of what the
 * page renders; gating on this constant shows PermissionDenied instead of
 * an unhandled failed fetch (GAP-PAYROLL-HOME-02/RUNS-04).
 */
export const PAYROLL_READER_ROLES = [...PAYROLL_ADMIN_ROLES, "hr_admin", "finance_officer"];

/**
 * Roles permitted to read the payroll register / comparison / CTC config
 * reports. Mirrors payroll-service world-class-routes.ts's own `ROLES`
 * (payroll_admin, payroll_officer, super_admin, hr_admin) -- narrower than
 * PAYROLL_READER_ROLES: "finance_officer" gets a 403 from those endpoints,
 * and "employee"/"manager" (which hr/layout.tsx admits) must never see
 * department-wide salary totals (GAP-PAYROLL-REGISTER-05 /
 * GAP-PAYROLL-COMPARISON-03).
 */
export const PAYROLL_REPORT_ROLES = [...PAYROLL_ADMIN_ROLES, "hr_admin"];

/**
 * Roles permitted to approve/reject a cycle count. Mirrors inventory-service's
 * APPROVE_ROLES in modules/cycle-count/routes.ts (GAP-INVENTORY-CYCLE-COUNTS-DETAIL-02);
 * the server remains the authority (it also enforces maker != checker).
 */
export const INVENTORY_CYCLE_COUNT_APPROVE_ROLES = ["inventory_manager", "inventory_admin", "super_admin"];

/**
 * Roles permitted to create inventory master data (bins, items). Mirrors
 * inventory-service's WRITE_ROLES in modules/items/routes.ts
 * (GAP-INVENTORY-BINS-03 / GAP-INVENTORY-ITEMS-03); the service stays the
 * authority, this only stops offering a control that is guaranteed to 403.
 */
export const INVENTORY_WRITE_ROLES = ["inventory_user", "inventory_manager", "inventory_admin", "store_keeper", "super_admin"];

/**
 * Roles permitted to activate/deactivate a bin. Mirrors inventory-service's
 * BIN_ADMIN_ROLES in modules/items/routes.ts (GAP-INVENTORY-BINS-03); the
 * service stays the authority.
 */
export const INVENTORY_BIN_MANAGE_ROLES = ["inventory_manager", "inventory_admin", "super_admin"];

/**
 * Roles permitted to change tenant inventory policy (QC maker-checker).
 * Mirrors inventory-service's SETTINGS_ROLES (GAP-INVENTORY-GOODS-RETURNS-DETAIL-04).
 */
export const INVENTORY_SETTINGS_ROLES = ["inventory_admin", "super_admin"];

/**
 * Who may confirm or remove an inventory <-> stock item link and open the unlinked-items report.
 * Mirrors LINK_ROLES in inventory-service modules/item-links/routes.ts
 * (GAP-INVENTORY-DETAIL-04 / GAP-INVENTORY-LIST-02); the service stays the real gate.
 */
export const INVENTORY_ITEM_LINK_ROLES = ["inventory_manager", "inventory_admin", "super_admin"];

/**
 * Roles that may reach the CRM platform-wide admin-config routes (Custom
 * Fields, Matching/Dedup Rules, Lead Scoring, Qualification Frameworks, Lead
 * Stage Reasons, Assignment Rules, Assignment Directory, Agent Workload,
 * Escalation Rules, Task Escalation, Document Types). Every one of those route
 * layouts gates on this same set, and the CRM hub (page.tsx) hides the whole
 * Configuration section from anyone outside it, so the tiles and the route
 * guards agree (GAP-CRM-HOME-01 / GAP-CRM-AGENT-WORKLOAD-01). The server
 * remains the authority; this is defence-in-depth + UX. A plain crm_user is
 * deliberately excluded.
 */
export const CRM_ADMIN_ROLES = ["crm_admin", "admin", "super_admin", "platform_admin", "tenant_admin"];

/**
 * Roles permitted to approve/reject a quotation discount or deviation
 * exception. Mirrors crm-service's ADMIN_ROLES in
 * modules/deals/quotation-approval-routes.ts (the POST
 * /v1/crm/quotation-approvals/:id/decide gate; the server stays the
 * authority). A plain crm_user who merely raised the request must not be
 * offered Approve/Reject — the panel also hides those controls on the
 * requester's own row (maker-checker). GAP-CRM-QUOTATIONS-01.
 */
export const CRM_QUOTATION_APPROVE_ROLES = ["crm_admin", "super_admin", "tenant_admin"];

/**
 * Roles permitted to see vigilance-sensitive Voice-of-Citizen themes
 * (staff conduct, integrity/corruption concerns) and to export them
 * (GAP-CRM-VOICE-OF-CUSTOMER-05). DECISION (safest default, pending vigilance/
 * DPO confirmation — flagged for HUMAN REVIEW): these aggregates can implicate
 * named staff and are vigilance material, so a plain crm_user must NOT see or
 * export them. Restricted to CRM admins. The sentiment summary API should
 * enforce the same filter server-side so this is not client-only; until it
 * does, this UI gate is defence-in-depth and the restricted rows/export are
 * omitted for unauthorised viewers with the totals labelled accordingly.
 */
export const CRM_VIGILANCE_ROLES = ["crm_admin", "admin", "super_admin", "platform_admin", "tenant_admin"];

/**
 * Roles permitted to read full contact PII (phone/email in the clear) rather
 * than the masked form (GAP-CRM-CONTACTS-02 / GAP-CRM-CONTACTS-DETAIL-02).
 * DPDP: the base crm_user sees masked values; only privileged/admin roles see
 * the clear value. The server remains the authority — this only decides what
 * the UI renders. NOTE (HUMAN REVIEW): true redaction requires the contacts
 * API to omit the clear value for roles outside this set; UI masking alone is
 * cosmetic until that backend change lands.
 */
export const CRM_PII_READ_ROLES = ["crm_admin", "admin", "super_admin", "platform_admin", "tenant_admin"];

/**
 * Roles permitted to bulk-export contacts (name/phone/email egress)
 * (GAP-CRM-CONTACTS-01). Narrower than general CRM access: the base crm_user
 * must not be able to download the whole registry. Mirrors the PII-read set.
 */
export const CRM_CONTACTS_EXPORT_ROLES = ["crm_admin", "admin", "super_admin", "platform_admin", "tenant_admin"];

/**
 * Roles permitted to verify/reject uploaded account & contact documents
 * (GAP-CRM-ACCOUNTS-DETAIL-02). Document verification is an approval control,
 * so it is restricted to CRM admins rather than every crm_user — the detail
 * pages previously passed canVerify unconditionally, showing Verify/Reject to
 * every crm_user. The server remains the authority (the verify endpoint must
 * 403 others); this only decides whether the UI offers the control.
 */
export const CRM_VERIFY_ROLES = ["crm_admin", "admin", "super_admin", "platform_admin", "tenant_admin"];

/**
 * Roles permitted to close (won/lost/cancelled/on_hold) an opportunity
 * (GAP-CRM-OPPORTUNITIES-03). Closing a deal is irreversible and feeds revenue
 * reporting, so the base crm_user must not be offered the Close control on every
 * open row — it is restricted to CRM admins (the safest default; the gap left
 * owner-vs-admin open and owner scoping is not knowable client-side). The server
 * remains the authority — the close endpoint must 403 others; this only decides
 * whether the UI offers the control.
 */
export const CRM_OPPORTUNITY_CLOSE_ROLES = ["crm_admin", "admin", "super_admin", "platform_admin", "tenant_admin"];

/**
 * Roles permitted to administer tenant-wide CRM configuration that drives
 * alerts/behaviour for everyone — e.g. stage day-limits on /crm/opportunity-ageing
 * (GAP-CRM-OPPORTUNITY-AGEING-05). The ageing *view* stays useful to every
 * crm_user (managers chase stalled deals), but the Save/Delete limits config is
 * admin-only. Mirrors the admin role list used by the task-escalation and
 * qualification-frameworks layouts. The server remains the authority (the
 * stage-limits write endpoints must 403 non-admins); this only decides whether
 * the UI offers the config controls.
 */
export const CRM_CONFIG_ADMIN_ROLES = ["crm_admin", "admin", "super_admin", "platform_admin", "tenant_admin"];

/**
 * Roles permitted to sign off (or reject) a customer-onboarding KYC check
 * (GAP-CRM-ONBOARDING-DETAIL-03). Mirrors crm-service's KYC_APPROVER_ROLES in
 * modules/onboarding/routes.ts (the POST /v1/crm/onboarding-cases/:id/kyc gate
 * for a "verified"/"rejected" outcome; the server stays the authority and 403s
 * others). Recording a KYC outcome as "submitted" needs only a CRM write role;
 * only verification/rejection is an approver action, so the UI hides those two
 * outcomes from a non-approver rather than letting them hit a guaranteed 403.
 */
export const CRM_KYC_APPROVER_ROLES = ["crm_admin", "super_admin", "tenant_admin"];

/**
 * GAP-CRM-GRIEVANCES-DETAIL-02: roles permitted to administratively close
 * (dispose) a grievance. Mirrors crm-service's ADMIN_ROLES in
 * modules/grievances/routes.ts (the PATCH /v1/crm/grievances/:id/close gate;
 * the server stays the authority and 403s others). The base crm_user is 403'd
 * by that endpoint, so the UI must not offer the Close control to them — hiding
 * it is a UX courtesy, not the security boundary.
 */
export const CRM_GRIEVANCE_CLOSE_ROLES = ["crm_admin", "super_admin", "tenant_admin"];

/**
 * Roles permitted to reach the /platform-admin segment (system settings, org
 * config, roles & permissions, audit log, user management). These pages
 * administer tenant-wide RBAC, security configuration and audit data, so the
 * segment layout gates on this set and the server (admin-service /
 * identity-service / audit-service) remains the authority.
 *
 * DECISION (GAP-PLATFORM-ADMIN-ROLES-02 / -SYSTEM-SETTINGS-03 /
 * -AUDIT-LOG-02 / -ORG-CONFIG-02 / -HOME-01, safest default pending product
 * confirmation — flagged for HUMAN REVIEW): include tenant_admin alongside
 * platform_admin/super_admin. A segment-wide gate limited to
 * platform_admin/super_admin risks locking a tenant_admin out of the audit log
 * and settings they legitimately use today; a plain user (employee, hr_staff,
 * crm_user, …) is excluded either way, which is what the ROLEGATE gaps
 * require. Narrow this to platform_admin/super_admin if product decides
 * tenant_admin must not administer the platform.
 */
export const PLATFORM_ADMIN_ROLES = ["platform_admin", "super_admin", "tenant_admin"];

/**
 * Read-only audit reviewers. The /platform-admin segment layout admits them (so the
 * audit log stays reachable, as it was before the segment gate), but every page other
 * than /platform-admin/audit-log re-checks PLATFORM_ADMIN_ROLES itself. The audit-service
 * remains the authority on who may read events.
 */
export const PLATFORM_AUDIT_VIEW_ROLES = ["auditor", "audit_admin", "audit_officer"];

/**
 * Roles permitted to include PII columns in an audit export.
 * MUST mirror audit-service PII_EXPORT_ROLES (exports/validators.ts). The server
 * is the authority; this constant only drives UI gating of the PII checkbox.
 */
export const AUDIT_PII_EXPORT_ROLES = ["audit_admin", "super_admin", "platform_admin"];

/**
 * GAP-AUDIT-INVESTIGATION-02: roles permitted to read the free-text subject /
 * findings of an internal investigation and to export the register to CSV.
 * Conservative default (DPDP): audit roles only — finance_admin / dept_head
 * reach the audit layout but must NOT read every sensitive case's free text.
 * UI masking alone is advisory; server-side redaction is tracked for HUMAN
 * REVIEW (see batch report).
 */
export const AUDIT_INVESTIGATION_DETAIL_ROLES = ["audit_officer", "audit_admin", "super_admin"];

/**
 * GAP-AUDIT-OBSERVATIONS-DETAIL-02: who may act on an observation. Mirrors
 * audit-service observation/routes.ts role lists; the server is the authority.
 * - reply (compliance ATN): AUDITEE_ROLES
 * - refer (draft audit para): AUDIT_ROLES
 */
export const AUDIT_OBSERVATION_REPLY_ROLES = ["dept_head", "dept_officer", "finance_officer", "audit_officer", "audit_admin", "super_admin"];
export const AUDIT_OBSERVATION_REFER_ROLES = ["audit_officer", "audit_admin", "super_admin"];

/**
 * GAP-AUDIT-OBSERVATIONS-DETAIL-05: who may accept/reject the auditee's
 * compliance reply (ATN). MUST mirror audit-service observation/routes.ts
 * REVIEW_ROLES — the server is the authority (POST /v1/audit/observations/:id/review
 * is gated to these roles and 403s everyone else). Accepting a reply is a
 * compliance-closing action, so this is deliberately the narrow authority set.
 */
export const AUDIT_OBSERVATION_REVIEW_ROLES = ["audit_admin", "super_admin"];

/** True when any of the session roles is in `allowed`. Pure; for UI gating. */
export function hasAnyRole(sessionRoles: string[], allowed: string[]): boolean {
  return allowed.some((r) => sessionRoles.includes(r));
}

/**
 * GAP-BILLING-HOME-01 / GAP-BILLING-GSTN-01: billing module role gating.
 *
 * The billing-service enforces roles server-side on every route (verified):
 *  - invoices list/detail + e-invoice generate/cancel: BILLING_ROLES =
 *    ["billing_admin","tenant_admin","super_admin","platform_admin"]
 *    (services/billing-service/src/modules/invoices/routes.ts,
 *     .../einvoice/routes.ts)
 *  - GSTN return filing / status / GSTIN verify: a wider finance set
 *    ["finance_officer","finance_admin","billing_admin","tenant_admin",
 *     "super_admin"] (services/billing-service/src/modules/gstn/routes.ts)
 *
 * The web layer had NO gate at all, so every tenant user saw links to IRN
 * cancel and GSTN return filing (and learned they lacked access only from a
 * failed call). These constants mirror the server sets so the web layout can
 * add a matching requireAnyRole gate (defence-in-depth + honest UX); the
 * server remains the real authority.
 *
 * BILLING_MODULE_ROLES is the UNION (anyone who can use ANY billing sub-route),
 * used by the billing hub layout so it never locks out a user a sub-route would
 * admit. The GSTN layout additionally narrows to BILLING_GSTN_ROLES.
 */
export const BILLING_GSTN_ROLES = ["finance_officer", "finance_admin", "billing_admin", "tenant_admin", "super_admin"];
export const BILLING_MODULE_ROLES = Array.from(new Set([...BILLING_INVOICE_READER_ROLES, ...BILLING_GSTN_ROLES]));

/**
 * GAP-BILLING-PLANS-05: roles permitted to CREATE a billing plan. The
 * billing-service route `POST /v1/billing/plans` enforces `requireSuperAdmin`
 * (services/billing-service/src/modules/plans/routes.ts), so this web gate is
 * deliberately the narrowest possible set — super_admin only — to match the
 * server's own enforcement exactly and fail closed. The UI gate (hiding the
 * "+ New Plan" control and redirecting away from /billing/plans/new) is
 * defence-in-depth / convenience; the server is the authoritative gate.
 */
export const BILLING_PLAN_ADMIN_ROLES = ["super_admin"];
