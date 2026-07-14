/**
 * court feature — admin config metadata (§47 config engine).
 *
 * Unlike a scalar policy engine, the court config-registry is mostly a set of
 * ENUMERATION namespaces: each namespace holds the allowed values (as active
 * config entries) for a court concept — case types, order types, hearing
 * purposes, etc. When a tenant configures ANY active entry for a namespace,
 * that set is AUTHORITATIVE and fully replaces the module defaults
 * (config-registry/domain.ts effectiveAllowed). One numeric namespace,
 * `sla_timer`, carries the disposal SLA window.
 *
 * Namespaces + module defaults mirror
 * services/court-service/src/modules/config-registry/domain.ts (KNOWN_NAMESPACES),
 * case-registry/domain.ts (DEFAULT_CASE_TYPES, DEFAULT_DISPOSAL_DAYS) and
 * party/validators.ts (PARTY_ROLE_VALUES) so the admin sees the true engine
 * baseline even before any config row exists. This is reference metadata —
 * live values come from GET /api/v1/court/config/<namespace>.
 */

/** An enumeration namespace: allowed values are managed as active config rows. */
export interface EnumNamespace {
  namespace: string;
  title: string;
  description: string;
  /** Module fallback values shown when the tenant has configured none. */
  defaults: string[];
}

export const SLA_NS = "sla_timer";
export const SLA_KEY = "disposal";
export const DEFAULT_DISPOSAL_DAYS = 180;

export const ENUM_NAMESPACES: EnumNamespace[] = [
  {
    namespace: "court_type",
    title: "Court types",
    description:
      "The kinds of court/forum this tenant constitutes (e.g. Tehsildar, SDM, Collector, Tribunal). Seed a vertical preset for a sensible baseline.",
    defaults: [],
  },
  {
    namespace: "case_type",
    title: "Case types",
    description:
      "The case categories a matter may be registered under. When you configure any value here it fully replaces the built-in defaults below.",
    defaults: [
      "civil",
      "revenue_appeal",
      "mutation",
      "partition",
      "land_acquisition",
      "consumer_complaint",
      "execution",
      "revision",
      "review",
      "misc_application",
      "tenancy",
      "criminal",
    ],
  },
  {
    namespace: "order_type",
    title: "Order types",
    description:
      "The order categories a judicial officer may record (e.g. Interim, Final, Dismissal).",
    defaults: [],
  },
  {
    namespace: "hearing_purpose",
    title: "Hearing purposes",
    description: "The listed purpose values a hearing may be scheduled for.",
    defaults: [],
  },
  {
    namespace: "party_role",
    title: "Party roles",
    description: "The roles a party may take on a case (petitioner, respondent, advocate, …).",
    defaults: [
      "petitioner",
      "respondent",
      "applicant",
      "opposite_party",
      "intervenor",
      "advocate",
      "witness",
    ],
  },
  {
    namespace: "evidence_type",
    title: "Evidence types",
    description: "The evidence categories that may be filed and marked on a case.",
    defaults: [],
  },
  {
    namespace: "notice_template",
    title: "Notice templates",
    description: "The registered notice/summons template keys available to the registry.",
    defaults: [],
  },
];

export const ENUM_NAMESPACE_KEYS = ENUM_NAMESPACES.map((n) => n.namespace);

/** Read the numeric disposal-days SLA out of an sla_timer config value. */
export function readDisposalDays(value: unknown): number {
  if (value && typeof value === "object" && "disposalDays" in value) {
    const dd = (value as { disposalDays: unknown }).disposalDays;
    if (typeof dd === "number" && Number.isInteger(dd) && dd > 0) return dd;
  }
  return DEFAULT_DISPOSAL_DAYS;
}

/** Encode a disposal-days number into the sla_timer config value shape. */
export function encodeDisposalDays(days: number): unknown {
  return { disposalDays: days };
}

export const PRESET_LABELS: Record<string, string> = {
  revenue: "Revenue courts",
  consumer: "Consumer commission",
  tribunal: "Tribunal / appellate",
};
