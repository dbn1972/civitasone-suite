/**
 * meeting feature — admin config metadata.
 *
 * Declarative catalogue of the policy knobs the meeting-service config engine
 * governs, grouped for the admin screen. Namespaces, keys and DEFAULTS mirror
 * services/meeting-service/src/modules/config-registry/policy.ts exactly
 * (POLICY_NS, COMMITTEE_TYPES_NS, POLICY_DEFAULTS, DEFAULT_COMMITTEE_TYPES) so
 * the admin sees the true engine default even before any config row exists.
 *
 * This is reference metadata (labels/defaults/types), not live data — live
 * values are read from GET /api/v1/meeting/config/<namespace>.
 */
export const POLICY_NS = "meeting_policy";
export const COMMITTEE_TYPES_NS = "meeting_committee_types";

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
   * per-field below, generously above the shipped default so legitimate
   * tuning isn't blocked, but tight enough to catch fat-fingered entry (e.g.
   * "24" typed as "240000" for an hours field). The service's own validator
   * (config-registry/validators.ts) is the authority server-side — these are
   * a UX guard only, not a substitute for it.
   */
  min?: number;
  max?: number;
}

export interface PolicyGroup {
  title: string;
  description: string;
  fields: PolicyField[];
}

export const POLICY_GROUPS: PolicyGroup[] = [
  {
    title: "Agenda workflow",
    description: "Deadlines and defaults applied when agenda items are proposed and circulated.",
    fields: [
      {
        namespace: POLICY_NS,
        configKey: "agenda.submission_deadline_days",
        label: "Agenda submission deadline",
        help: "How many days before a meeting agenda proposals must be submitted.",
        kind: "number",
        default: 7,
        unit: "days",
        min: 1,
        max: 90,
      },
      {
        namespace: POLICY_NS,
        configKey: "agenda.default_item_duration_minutes",
        label: "Default agenda item duration",
        help: "Default time budgeted per agenda item when none is specified.",
        kind: "number",
        default: 15,
        unit: "minutes",
        min: 1,
        max: 480,
      },
    ],
  },
  {
    title: "Minutes workflow",
    description: "The maker-checker cadence for drafting, alerting and approving minutes.",
    fields: [
      {
        namespace: POLICY_NS,
        configKey: "minutes.submission_deadline_days",
        label: "Draft minutes deadline",
        help: "How many days after a meeting the secretary must submit draft minutes.",
        kind: "number",
        default: 7,
        unit: "days",
        min: 1,
        max: 90,
      },
      {
        namespace: POLICY_NS,
        configKey: "minutes.deadline_alert_lead_days",
        label: "Minutes deadline alert lead",
        help: "How many days ahead of the minutes deadline to raise a reminder.",
        kind: "number",
        default: 2,
        unit: "days",
        // 0 is valid here (alert on the deadline day itself) — this is a
        // lead time, not a deadline, so unlike the deadline fields above it
        // isn't required to be positive.
        min: 0,
        max: 30,
      },
    ],
  },
  {
    title: "Committee governance",
    description: "Notice periods for committee tenure and constitution.",
    fields: [
      {
        namespace: POLICY_NS,
        configKey: "committee.tenure_advance_notice_days",
        label: "Tenure expiry advance notice",
        help: "How far ahead of a member's tenure expiry to notify the secretariat.",
        kind: "number",
        default: 30,
        unit: "days",
        min: 1,
        max: 365,
      },
    ],
  },
  {
    title: "Action-item escalation",
    description: "The escalation ladder for overdue action items arising from decisions.",
    fields: [
      {
        namespace: POLICY_NS,
        configKey: "action_item.escalation_l1_hours",
        label: "Escalate to supervisor after",
        help: "Hours past the deadline before an overdue action item escalates to the supervisor.",
        kind: "number",
        default: 24,
        unit: "hours",
        // Ceiling of 2160h (90 days) — an escalation ladder measured in
        // months-plus stops being a meaningful escalation.
        min: 1,
        max: 2160,
      },
      {
        namespace: POLICY_NS,
        configKey: "action_item.escalation_l2_hours",
        label: "Escalate to department head after",
        help: "Hours past the deadline before it escalates to the department head.",
        kind: "number",
        default: 72,
        unit: "hours",
        min: 1,
        max: 2160,
      },
      {
        namespace: POLICY_NS,
        configKey: "action_item.escalation_l3_hours",
        label: "Escalate to chairperson after",
        help: "Hours past the deadline before it escalates to the chairperson.",
        kind: "number",
        default: 168,
        unit: "hours",
        min: 1,
        max: 2160,
      },
    ],
  },
  {
    title: "Permitted committee types",
    description:
      "Which body types this tenant may constitute. When none are toggled on, the full default set (standing, ad-hoc, statutory, board) applies.",
    fields: [
      {
        namespace: COMMITTEE_TYPES_NS,
        configKey: "standing",
        label: "Standing committees",
        help: "Permit standing (permanent) committees.",
        kind: "boolean",
        default: true,
      },
      {
        namespace: COMMITTEE_TYPES_NS,
        configKey: "ad_hoc",
        label: "Ad-hoc committees",
        help: "Permit ad-hoc (temporary) committees.",
        kind: "boolean",
        default: true,
      },
      {
        namespace: COMMITTEE_TYPES_NS,
        configKey: "statutory",
        label: "Statutory committees",
        help: "Permit statutory (legally mandated) committees.",
        kind: "boolean",
        default: true,
      },
      {
        namespace: COMMITTEE_TYPES_NS,
        configKey: "board",
        label: "Board committees",
        help: "Permit board-level committees.",
        kind: "boolean",
        default: true,
      },
    ],
  },
];

/**
 * committee-types values are objects like { allowed: true }; policy scalars are
 * plain JSON. Read a boolean field's effective value from a raw config value.
 */
export function readBooleanValue(raw: unknown, field: PolicyField): boolean {
  if (field.namespace === COMMITTEE_TYPES_NS) {
    if (raw && typeof raw === "object" && "allowed" in raw) {
      return Boolean((raw as { allowed: unknown }).allowed);
    }
    if (typeof raw === "boolean") return raw;
    return Boolean(field.default);
  }
  return typeof raw === "boolean" ? raw : Boolean(field.default);
}

/** Encode a boolean back into the shape the config engine expects for its namespace. */
export function encodeBooleanValue(namespace: string, next: boolean): unknown {
  return namespace === COMMITTEE_TYPES_NS ? { allowed: next } : next;
}
