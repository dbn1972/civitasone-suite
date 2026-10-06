/**
 * Municipal Sec5 (BRD §5) — shared config type for the officer web catalog.
 * One config module per service (./<serviceKey>.ts); the barrel in ./index.ts
 * assembles them into MUNICIPAL_SERVICE_CATALOG. Splitting per service keeps
 * each future per-service PR scoped to its own file instead of a single
 * shared array (see HANDOFF — this pattern has caused repeat merge
 * conflicts on shared files like scripts/ci/bootstrap-postgres.sh).
 */
export type MunicipalServiceConfig = {
  /** URL segment under /municipal/{serviceKey} */
  serviceKey: string;
  /** Tenant module enablement key (policy-service municipal-catalog moduleKey) */
  moduleKey: string;
  label: string;
  shortLabel: string;
  icon: string;
  description: string;
  /** Gateway list path, e.g. /api/v1/trade/applications */
  listPath: string;
  /** Officer-facing resource label (Applications, Registrations, …) */
  resourceLabel: string;
  /** Fields tried in order for the primary table/detail title */
  titleFields: string[];
  /** Fields tried in order for reference / tracking number column */
  numberFields: string[];
  /**
   * citizen-service domain-pack manifest key this service links to, for
   * /citizen/services/{key} apply + track. Omitted when no citizen-facing
   * pack exists yet for this service (building, animal, drainage, parks,
   * refund, swm as of this catalog) — callers must not render citizen
   * apply/track links when this is unset.
   */
  citizenServiceKey?: string;
  /**
   * GAP-MUNICIPAL-SERVICEKEY-APPLICATIONS-DETAIL-01: record keys whose values
   * are DPDP-sensitive personal data (phone, email, identity numbers, …) and
   * must be masked by default in the read-only detail panel. Key-name
   * heuristics (mobile/phone/aadhaar/pan/email/address) mask automatically;
   * this list is for fields the heuristics would miss.
   */
  piiFields?: readonly string[];
  /**
   * GAP-MUNICIPAL-SERVICEKEY-APPLICATIONS-DETAIL-01: record keys that must
   * never be rendered at all (internal/document identifiers, raw tokens).
   */
  hiddenFields?: readonly string[];
  /**
   * GAP-MUNICIPAL-SERVICEKEY-APPLICATIONS-DETAIL-03: preferred leading order of
   * detail fields (status, reference, owner, …); any key not listed falls
   * after these, alphabetically by label.
   */
  fieldOrder?: readonly string[];
  /** Sec5 scope (shop is reference template, not part of the 16) */
  sec5: boolean;
};
