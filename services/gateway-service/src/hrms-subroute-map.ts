/**
 * HRMS sub-route → gateway module-key split (ST-M01-04b, FF-03).
 *
 * SMARTTRANSFER-MASTER-SPEC-v3 §3 (product modes / standalone SKU), §14
 * (security — fail-closed module gating). Decisions: D-ST-23 (Workforce Core is
 * a licensable hrms-service profile; SmartTransfer is its own SKU) and D-ST-24
 * (per-tenant off/shadow/enforce modes + grandfather backfill, delivered by
 * ST-M01-02 / migrations 0050 + this row's 0051).
 *
 * WHY THIS EXISTS
 * ---------------
 * The gateway registry (services/gateway-service/src/registry.ts) proxies the
 * ENTIRE hrms-service under ONE route — `{ name: "hrms", prefix: "/api/v1/hrms" }`
 * (plus the `hr` alias and `careers`). The module-guard therefore saw a single
 * route-key `hrms` for leave, attendance, recruitment, payroll-facing, training,
 * disciplinary, … and the Workforce-Core surface alike. A tenant entitled to the
 * `hrms` gateway key could reach EVERY HRMS sub-route. For the standalone SKU a
 * `smarttransfer_standalone` tenant must reach ONLY Workforce Core (+ platform +
 * SmartTransfer) and be BLOCKED from leave / attendance / recruitment /
 * payroll-facing and the other non-core HRMS surfaces (M01 exit criterion 3).
 *
 * This module makes the guard PATH-AWARE for the HRMS surface: it maps the first
 * path segment under `/api/v1/hrms/<seg>` (and the `/api/v1/hr`, `/api/v1/careers`
 * aliases) to a distinct gateway module-key. The in-service `HRMS_MODULES=core`
 * profile (ST-M01-04 / #1980) is the BELT — it never registers the non-core
 * routes, so they 404 at the source; this split is the gateway BRACES
 * (defense in depth), so the request is refused before it is ever proxied.
 *
 * APPROXIMATION NOTE (`career`): the composition module `career` (Transfer &
 * Promotion) projects to the `hrms-recruitment` gateway key in
 * services/admin-service/src/modules/composition/gateway-map.ts because it
 * surfaces through the recruitment/careers routes. That is an approximation, not
 * an exact module boundary: a tenant entitled to `career` is allowed the
 * `hrms-recruitment` sub-routes (and `/api/v1/careers/*` resolves the same way).
 *
 * PATH DELIMITER: the first segment is truncated at the first `;` before lookup
 * because Fastify 4 (hrms-service) treats `;` as a path delimiter
 * (`/leave;x/apply` is served as `/leave`).
 *
 * KEY NAMING (aligned with #1980's HRMS_MODULES names + composition module ids)
 * ----------------------------------------------------------------------------
 * Core HRMS resolves to the `workforce_core` composition module-id/gateway-key
 * (the Workforce Core profile, D-ST-23). Each non-core cluster gets an
 * `hrms-<module>` key whose suffix mirrors the HRMS_MODULES name used by
 * services/hrms-service/src/shared/module-profile.ts (`leave`, `attendance`,
 * `recruitment`, `appraisal`, `payroll_facing`→`payroll`, `training`, `social`,
 * `disciplinary`, `deputation`, `contracts`, `assessment`, `id_cards`→`id-cards`,
 * `device_trust`→`device-trust`, `ai`, `rti`, `gap_features`→`gap`,
 * `workforce_planning`→`workforce-planning`, `board_intake`→`board-intake`,
 * `competency`, `self_service`→`self-service`). The composition projection
 * (services/admin-service/src/modules/composition/gateway-map.ts) emits exactly
 * these keys, so the two stay in lock-step. Every key is < 45 chars (D-ST-19).
 *
 * AMBIGUITY RULE (safety: never over-block the core surface)
 * ----------------------------------------------------------
 * Several HRMS top-level path segments are shared between a CORE plugin and a
 * NON-CORE plugin (both mount sub-paths under the same first segment), e.g.
 * `/v1/hrms/employees` (core employee master + payroll-facing employee sub-
 * resources), `/v1/hrms/onboarding` (core lifecycle + gap-features),
 * `/v1/hrms/deputation` (core lifecycle + the deputation mover),
 * `/v1/hrms/loans` + `/v1/hrms/salary-advances` (core employee module + the
 * payroll-facing loans route), `/v1/hrms/goals` / `/v1/hrms/feedback` /
 * `/v1/hrms/analytics` / `/v1/hrms/devices` / `/v1/hrms/disciplinary-cases`
 * / `/v1/hrms/benefits` / `/v1/hrms/orgchart`. For those shared segments the
 * only safe gateway decision is CORE (`workforce_core`): a path-prefix match
 * cannot tell a core sub-path from a non-core one, so blocking them would 403 a
 * legitimate core request. The non-core sub-resources mounted under a shared
 * segment are still denied AT THE SOURCE by the in-service `HRMS_MODULES=core`
 * profile (they 404), so no non-core surface leaks for a standalone tenant.
 * Only the UNAMBIGUOUS non-core segments (leave*, attendance/shift*, the
 * recruitment set, …) are mapped to a non-core key here.
 *
 * Any segment not listed below resolves to `workforce_core` — the conservative
 * default keeps the core/unknown surface reachable; it never widens a non-core
 * surface, because a tenant must still be ENTITLED to `workforce_core` for the
 * request to pass (a standalone tenant is; a tenant with none of the HRMS keys
 * is blocked on the whole surface in enforce mode exactly as before).
 */

/** The gateway module-key for the core Workforce Core HRMS surface. */
export const WORKFORCE_CORE_KEY = "workforce_core";

/**
 * First-path-segment → non-core gateway module-key. Only UNAMBIGUOUS non-core
 * segments appear (see the "ambiguity rule" above). Segments shared with a core
 * plugin are intentionally ABSENT so they fall through to `workforce_core`.
 */
export const HRMS_SUBROUTE_TO_KEY: Record<string, string> = {
  // ── leave (HRMS_MODULES "leave") ─────────────────────────────────────────
  leave: "hrms-leave",
  "leave-allocations": "hrms-leave",
  "leave-applications": "hrms-leave",
  "leave-context": "hrms-leave",
  "leave-requests": "hrms-leave",
  "leave-types": "hrms-leave",
  "comp-off": "hrms-leave",
  // ── attendance (HRMS_MODULES "attendance") ───────────────────────────────
  attendance: "hrms-attendance",
  "overtime-requests": "hrms-attendance",
  "shift-requests": "hrms-attendance",
  shifts: "hrms-attendance",
  "wfh-requests": "hrms-attendance",
  // ── recruitment (HRMS_MODULES "recruitment") ─────────────────────────────
  recruitment: "hrms-recruitment",
  applications: "hrms-recruitment",
  candidates: "hrms-recruitment",
  interviews: "hrms-recruitment",
  "interview-recordings": "hrms-recruitment",
  "interview-reschedule-requests": "hrms-recruitment",
  recordings: "hrms-recruitment",
  "jd-templates": "hrms-recruitment",
  "job-openings": "hrms-recruitment",
  offers: "hrms-recruitment",
  requisitions: "hrms-recruitment",
  "screening-overrides": "hrms-recruitment",
  "selection-lists": "hrms-recruitment",
  "talent-pool": "hrms-recruitment",
  // ── appraisal (HRMS_MODULES "appraisal") ─────────────────────────────────
  appraisals: "hrms-appraisal",
  apar: "hrms-appraisal",
  // ── payroll-facing (HRMS_MODULES "payroll_facing") ───────────────────────
  // pension/gpf/nps/cpf/pay-profile mount under the shared `employees` segment
  // (core default). Only the non-core-exclusive segments are mapped here.
  "pay-matrix": "hrms-payroll",
  medical: "hrms-payroll",
  "cea-claims": "hrms-payroll",
  "ltc-claims": "hrms-payroll",
  // ── training & learning (HRMS_MODULES "training") ────────────────────────
  training: "hrms-training",
  "training-programs": "hrms-training",
  trainings: "hrms-training",
  nominations: "hrms-training",
  learning: "hrms-training",
  "learning-paths": "hrms-training",
  // ── social / engagement (HRMS_MODULES "social") ──────────────────────────
  social: "hrms-social",
  announcements: "hrms-social",
  birthdays: "hrms-social",
  kudos: "hrms-social",
  leaderboard: "hrms-social",
  "pulse-surveys": "hrms-social",
  expenses: "hrms-social",
  "travel-requests": "hrms-social",
  assistant: "hrms-social",
  // ── disciplinary / vigilance (HRMS_MODULES "disciplinary") ───────────────
  disciplinary: "hrms-disciplinary",
  suspensions: "hrms-disciplinary",
  icc: "hrms-disciplinary",
  grievances: "hrms-disciplinary",
  vigilance: "hrms-disciplinary",
  declarations: "hrms-disciplinary",
  // ── contracts & engagements (HRMS_MODULES "contracts") ───────────────────
  consultants: "hrms-contracts",
  "consultant-invoices": "hrms-contracts",
  contractors: "hrms-contracts",
  "contractor-bills": "hrms-contracts",
  "apprentice-stipends": "hrms-contracts",
  apprenticeships: "hrms-contracts",
  contracts: "hrms-contracts",
  outsourced: "hrms-contracts",
  // ── assessment (HRMS_MODULES "assessment") ───────────────────────────────
  assessment: "hrms-assessment",
  assessments: "hrms-assessment",
  attempts: "hrms-assessment",
  // ── id cards & visiting cards (HRMS_MODULES "id_cards") ───────────────────
  "id-cards": "hrms-id-cards",
  "visiting-card": "hrms-id-cards",
  // ── ai (HRMS_MODULES "ai") ───────────────────────────────────────────────
  ai: "hrms-ai",
  // ── rti (HRMS_MODULES "rti") ─────────────────────────────────────────────
  rti: "hrms-rti",
  // ── workforce planning (HRMS_MODULES "workforce_planning") ───────────────
  workforce: "hrms-workforce-planning",
  // ── board intake (HRMS_MODULES "board_intake") ───────────────────────────
  "board-intake": "hrms-board-intake",
  // ── competency (HRMS_MODULES "competency") ───────────────────────────────
  competency: "hrms-competency",
  // ── self-service / ESS (HRMS_MODULES "self_service") ─────────────────────
  me: "hrms-self-service",
};

/** Every distinct non-core HRMS gateway key this split can emit (for tests + projection parity). */
export const HRMS_NON_CORE_KEYS: readonly string[] = Object.freeze(
  [...new Set(Object.values(HRMS_SUBROUTE_TO_KEY))].sort(),
);

/**
 * Resolve the gateway module-key for an HRMS request path.
 *
 * @param pathname a canonicalised pathname such as `/api/v1/hrms/leave/apply`
 *                 or `/api/v1/hr/employees/123` or `/api/v1/careers/openings`.
 * @returns the sub-key for an unambiguous non-core segment, else
 *          `workforce_core` (core / shared / unknown segment).
 *
 * Only called for routes whose registry name resolves to the HRMS surface
 * (`hrms`, `hr`, `careers`); see services/gateway-service/src/module-guard.ts.
 */
export function resolveHrmsModuleKey(pathname: string): string {
  // Strip the leading `/api` the gateway prefixes carry, then the version +
  // surface segment, to isolate the first HRMS sub-segment. Matches:
  //   /api/v1/hrms/<seg>/...   /api/v1/hr/<seg>/...   /api/v1/careers/<seg>/...
  const m = pathname.match(/^\/api\/v\d+\/(?:hrms|hr|careers)\/([^/?#]+)/i);
  const captured = m?.[1];
  if (!captured) return WORKFORCE_CORE_KEY; // bare /api/v1/hrms or no sub-segment → core
  // Fastify 4 (hrms-service) treats `;` as a path delimiter, so `leave;x/apply`
  // is served as the `/v1/hrms/leave` route. Truncate at the first `;` (raw or
  // percent-encoded, after decoding) so the lookup keys on what the upstream
  // router will actually dispatch, never on the decorated segment.
  const seg = (decodeURIComponent(captured).split(";")[0] ?? "").toLowerCase();
  return HRMS_SUBROUTE_TO_KEY[seg] ?? WORKFORCE_CORE_KEY;
}

/** Route registry names that proxy to the HRMS surface and need path-aware keys. */
export const HRMS_ROUTE_NAMES: ReadonlySet<string> = new Set(["hrms", "hr", "careers"]);
