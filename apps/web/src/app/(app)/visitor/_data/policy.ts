/**
 * visitor feature — admin config metadata.
 *
 * Declarative catalogue of the policy knobs the config engine governs, grouped
 * for the admin screen. Defaults mirror the visitor-service vertical presets
 * (services/visitor-service/src/modules/config-registry/presets.ts) so the
 * admin sees a sensible baseline even before any config row exists. This is
 * reference metadata (labels/defaults/types), not live data — live values are
 * read from GET /v1/visitor/config/<namespace>.
 */
export const POLICY_NS = "visitor_policy";
export const APPROVAL_NS = "visitor_approval";

export type FieldKind = "number" | "boolean";

export interface PolicyField {
  namespace: string;
  configKey: string;
  label: string;
  help: string;
  kind: FieldKind;
  default: number | boolean;
  unit?: string;
  /**
   * Client-side bounds for `kind: "number"` fields (ignored otherwise). Chosen
   * per-field below, generously above the shipped default AND above every
   * vertical preset's value for that key (config-registry/presets.ts) so
   * applying a preset never immediately reads as out-of-range, but tight
   * enough to catch fat-fingered entry (e.g. "365" typed as "3650000" for a
   * retention field). The service's own config-registry accepts arbitrary
   * JSON per key (validators.ts has no per-field numeric schema) — these are
   * a UX guard only, not a substitute for server-side validation.
   */
  min?: number;
  max?: number;
}

export interface PolicyGroup {
  title: string;
  fields: PolicyField[];
}

export const POLICY_GROUPS: PolicyGroup[] = [
  {
    title: "Data retention & privacy",
    fields: [
      {
        namespace: POLICY_NS,
        configKey: "retention.pii_days",
        label: "Retain visitor PII",
        help: "How long visitor personal data is kept before erasure.",
        kind: "number",
        default: 365,
        unit: "days",
        // Hospital preset uses 1825 (5 years); ceiling gives headroom above
        // that for long-retention verticals while still catching typos.
        min: 1,
        max: 3650,
      },
      {
        namespace: POLICY_NS,
        configKey: "retention.erasure_sla_hours",
        label: "Erasure SLA",
        help: "Time to honour a DPDP erasure request.",
        kind: "number",
        default: 72,
        unit: "hours",
        // DPDP erasure must happen promptly — 720h (30 days) is already a
        // generous outer bound for a "request-to-erasure" SLA.
        min: 1,
        max: 720,
      },
    ],
  },
  {
    title: "Visit requests",
    fields: [
      {
        namespace: POLICY_NS,
        configKey: "visit_request.auto_reject_hours",
        label: "Auto-reject stale requests",
        help: "Un-actioned requests are auto-rejected after this window.",
        kind: "number",
        default: 24,
        unit: "hours",
        min: 1,
        max: 720,
      },
      {
        namespace: POLICY_NS,
        configKey: "visit_request.no_show_hours",
        label: "Mark no-show after",
        help: "Approved visitors who never arrive are flagged no-show.",
        kind: "number",
        default: 2,
        unit: "hours",
        // Hospital preset uses 4h; 72h (3 days) comfortably covers any
        // legitimate vertical without allowing an effectively-disabled value.
        min: 1,
        max: 72,
      },
      {
        namespace: POLICY_NS,
        configKey: "visit_request.max_lead_days",
        label: "Max scheduling lead time",
        help: "How far ahead a visit may be scheduled.",
        kind: "number",
        default: 30,
        unit: "days",
        // Hospital preset uses 90; a year is a generous outer bound for how
        // far ahead any visit could sensibly be scheduled.
        min: 1,
        max: 365,
      },
    ],
  },
  {
    title: "Check-in & overstay",
    fields: [
      {
        namespace: POLICY_NS,
        configKey: "check_in.overstay_grace_minutes",
        label: "Overstay grace period",
        help: "Grace after expected checkout before overstay escalation.",
        kind: "number",
        default: 15,
        unit: "minutes",
        // 0 is valid (secretariat preset: "No overstay grace") — this is a
        // grace window, not a deadline, so unlike the hour fields above it
        // isn't required to be positive.
        min: 0,
        max: 240,
      },
      {
        namespace: POLICY_NS,
        configKey: "check_in.overstay_escalation_hours",
        label: "Escalate overstay after",
        help: "When to escalate a visitor still on premises.",
        kind: "number",
        default: 1,
        unit: "hours",
        min: 1,
        max: 168,
      },
    ],
  },
  {
    title: "Passes & gates",
    fields: [
      {
        namespace: POLICY_NS,
        configKey: "digital_pass.multi_day_max_days",
        label: "Multi-day pass cap",
        help: "Maximum validity of a multi-day pass.",
        kind: "number",
        default: 3,
        unit: "days",
        // Bounded well below the separate recurring-pass cap (90d default)
        // since a multi-day pass is meant to be shorter-lived than that.
        min: 1,
        max: 90,
      },
      {
        namespace: POLICY_NS,
        configKey: "turnstile.anti_passback_enabled",
        label: "Anti-passback enforced",
        help: "Block re-entry on the same pass without an exit scan.",
        kind: "boolean",
        default: true,
      },
      {
        namespace: POLICY_NS,
        configKey: "turnstile.tailgating_tolerance",
        label: "Tailgating tolerance",
        help: "Permitted count mismatch before a tailgating alarm.",
        kind: "number",
        default: 1,
        // 0 is valid (zero tolerance); kept small since this counts people,
        // not a duration.
        min: 0,
        max: 10,
      },
    ],
  },
  {
    title: "Auto-approval (by visitor category)",
    fields: [
      {
        namespace: APPROVAL_NS,
        configKey: "vip",
        label: "Auto-approve VIP",
        help: "Skip manual approval for VIP-category visitors.",
        kind: "boolean",
        default: false,
      },
      {
        namespace: APPROVAL_NS,
        configKey: "contractor",
        label: "Auto-approve contractors",
        help: "Skip manual approval for contractor-category visitors.",
        kind: "boolean",
        default: false,
      },
      {
        namespace: APPROVAL_NS,
        configKey: "delegation",
        label: "Auto-approve delegations",
        help: "Skip manual approval for delegation-category visitors.",
        kind: "boolean",
        default: false,
      },
    ],
  },
];

/** Approval-namespace values are objects like { autoApprove: true }. */
export function readBooleanValue(raw: unknown, field: PolicyField): boolean {
  if (field.namespace === APPROVAL_NS) {
    if (raw && typeof raw === "object" && "autoApprove" in raw) {
      return Boolean((raw as { autoApprove: unknown }).autoApprove);
    }
    return Boolean(field.default);
  }
  return typeof raw === "boolean" ? raw : Boolean(field.default);
}

export function encodeBooleanValue(namespace: string, next: boolean): unknown {
  return namespace === APPROVAL_NS ? { autoApprove: next } : next;
}
