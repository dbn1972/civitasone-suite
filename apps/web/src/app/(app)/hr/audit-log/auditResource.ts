/**
 * Shared constants/helpers for the HR audit log page (GAP-HR-AUDIT-LOG-05/07/08).
 */

/**
 * `service` values whose audit events belong in the HR audit log. Every
 * hrms-service and payroll-service audit consumer writes its own name into
 * the event payload (`payload.service`); audit-service filters on it
 * (GET /audit/events?service=). Before this the page listed every event in
 * the tenant regardless of which service emitted it (the old `resourceType`
 * param was silently ignored by the backend).
 */
export const HR_AUDIT_SERVICES = ["hrms", "payroll"] as const;

/**
 * Canonical `payload.resourceType` values emitted by hrms-service and
 * payroll-service audit events (derived from both producer call forms -- `resourceType: "x"` literals and positional
 * `audit(...)`/`emitAudit(...)` args; auditResource.test.ts fails if this list drifts). Drives the resource-type filter.
 */
export const HR_AUDIT_RESOURCE_TYPES = [
  "ai_prediction",
  "announcement",
  "apar",
  "application",
  "application_fee",
  "appraisal",
  "attendance",
  "attendance_lock",
  "attendance_regularisation",
  "board_decision_intake",
  "bulk_import",
  "candidate_resume",
  "claim",
  "contract",
  "contract_renewal",
  "contract_renewal_bulk",
  "dashboard",
  "deputation",
  "device",
  "device_policy",
  "disciplinary_case",
  "disciplinary_case_list",
  "dsc_config",
  "employee",
  "employee_competency",
  "exemption_ceiling",
  "expense_claim",
  "face_config",
  "face_verification",
  "fnf_settlement",
  "fraud_alert",
  "fraud_scan",
  "geo_attendance",
  "geo_attendance_reportees",
  "gpf",
  "gratuity",
  "holiday",
  "icc_complaint",
  "id_card",
  "jd_template",
  "job_opening",
  "kudos",
  "leave_alloc",
  "leave_app",
  "leave_application",
  "leave_special",
  "leave_type",
  "loan",
  "ltc_exemption",
  "manpower_plan",
  "manpower_requisition",
  "medical_claim",
  "nomination",
  "orgchart",
  "pay_matrix",
  "payroll_arrear",
  "payroll_bonus",
  "payroll_correction",
  "payroll_costing_rule",
  "payroll_ddo",
  "payroll_flex_election",
  "payroll_flex_plan",
  "payroll_input",
  "payroll_off_cycle_run",
  "payroll_pay_group",
  "payroll_pensioner",
  "payroll_reimbursement",
  "payroll_run",
  "payroll_salary_revision",
  "payroll_settings",
  "payroll_state_rules",
  "payroll_structure",
  "pension",
  "perquisite_component",
  "profile_photo",
  "promotion",
  "recruitment",
  "report",
  "roster",
  "rti_request",
  "sanctioned_post",
  "scheduler",
  "screening_override",
  "seniority_list",
  "separation",
  "service_book",
  "sponsor_bank_config",
  "statutory_return",
  "tax_declaration",
  "tds_challan",
  "training",
  "transfer",
  "travel_request",
  "vigilance_case_list",
  "visiting_card",
  "workforce_plan",
] as const;

/** Detail-page route per resource type, for the types that have one keyed by the audited id. */
const RESOURCE_HREF: Record<string, (id: string) => string> = {
  employee: (id) => `/hr/employees/${encodeURIComponent(id)}`,
  disciplinary_case: (id) => `/hr/disciplinary/${encodeURIComponent(id)}`,
};

/** Link target for an audit row's resource, or undefined when there is no known detail page. */
export function resourceHref(type: string | undefined, id: string | undefined): string | undefined {
  if (!type || !id) return undefined;
  return RESOURCE_HREF[type]?.(id);
}

/** "Type · id" display text (CSV export carries the id); "" parts are dropped. */
export function resourceLabel(type: string | undefined, id: string | undefined, humanize: (s: string) => string): string | null {
  if (type && id) return `${humanize(type)} · ${id}`;
  if (id) return id;
  if (type) return humanize(type);
  return null;
}
