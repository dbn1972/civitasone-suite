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
 * payroll-service audit events (collected from their consumers'
 * `resourceType:` literals). Drives the resource-type filter.
 */
export const HR_AUDIT_RESOURCE_TYPES = [
  "ai_prediction", "announcement", "apar", "appraisal", "application", "attendance", "attendance_lock",
  "attendance_regularisation", "board_decision_intake", "bulk_import", "claim", "contract", "contract_renewal",
  "dashboard", "deputation", "device", "device_policy", "disciplinary_case", "dsc_config", "employee",
  "employee_competency", "expense_claim", "face_config", "face_verification", "fnf_settlement", "fraud_alert",
  "fraud_scan", "geo_attendance", "gpf", "gratuity", "holiday", "icc_complaint", "id_card", "jd_template",
  "job_opening", "kudos", "leave_alloc", "leave_app", "leave_application", "leave_special", "leave_type",
  "ltc_exemption", "manpower_plan", "manpower_requisition", "medical_claim", "nomination", "orgchart",
  "pay_matrix", "payroll_input", "payroll_run", "pension", "profile_photo", "promotion", "recruitment", "report",
  "roster", "rti_request", "sanctioned_post", "scheduler", "seniority_list", "separation", "service_book",
  "sponsor_bank_config", "statutory_return", "tds_challan", "training", "transfer", "travel_request",
  "visiting_card", "workforce_plan",
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
