/**
 * PAY-PROFILES: pure domain for per-employee pay profiles (HRMS side).
 *
 * A pay profile tells payroll WHICH pay computation applies to an employee:
 *
 *   govt_scale               central DA + 7th CPC HRA (today's behaviour; the
 *                            default whenever no approved profile exists)
 *   deputation_parent_scale  Option A: parent pay scale + deputation (duty) allowance
 *   deputation_post_scale    Option B: pay scale of the deputation post, no allowance
 *   ctc_contract             CTC package (structure + amount owned by payroll)
 *   consolidated_contract    one consolidated monthly amount
 *
 * HRMS owns the profile and the deputation pay terms; payroll owns the
 * computation. Everything here is pure so the resolution, validation and
 * feed-shaping rules are unit-testable without a database.
 */

export const PAY_PROFILES = [
  "govt_scale",
  "deputation_parent_scale",
  "deputation_post_scale",
  "ctc_contract",
  "consolidated_contract",
] as const;
export type PayProfile = (typeof PAY_PROFILES)[number];

export const DEPUTATION_PROFILES: ReadonlySet<PayProfile> = new Set(["deputation_parent_scale", "deputation_post_scale"]);

/** Which deputation pay option a deputation profile requires. */
export function requiredPayOption(profile: PayProfile): "parent_scale" | "post_scale" | null {
  if (profile === "deputation_parent_scale") return "parent_scale";
  if (profile === "deputation_post_scale") return "post_scale";
  return null;
}

export interface PayProfileRow {
  id: string;
  employeeId: string;
  payProfile: string;
  effectiveFrom: string;        // YYYY-MM-DD (always the 1st, DB CHECK)
  effectiveTo: string | null;   // YYYY-MM-DD inclusive, null = open
  status: string;               // pending | active | rejected
  deputationId: string | null;
  consolidatedMonthlyMinor: bigint | null;
  requestedBy: string;
  /** Deputation money terms approved with the profile (deputation profiles). */
  deputationTerms: DeputationMoneyTerms | null;
}

/** The subset of a deputation row the pay-profile rules need. */
export interface DeputationTerms {
  id: string;
  employeeId: string;
  status: string;
  direction: string;
  payOption: string | null;
  stationType: string | null;
  parentCadre: string;
  parentOrganisation: string | null;
  parentPayLevel: number | null;
  parentBasicMinor: bigint | null;
  postPayLevel: number | null;
  postBasicMinor: bigint | null;
  allowanceMode: string;
  deputationAllowanceMinor: bigint;
  foreignService: boolean;
  parentPensionScheme: string | null;
  daSource: string;
  parentDaRateBps: number | null;
  tenureFrom: string;
  tenureTo: string;
  repatriatedOn: string | null;
}

/**
 * The deputation-order fields that change PAY. A deputation profile carries
 * its own approved copy of these (hrms_pay_profiles.deputation_terms) and
 * payroll is fed that copy; editing them on a deputation that a live
 * (active or pending) profile references is refused -- HR raises a new
 * profile request instead, so every pay-affecting change is maker-checked.
 * Money as digit strings (JSON-safe).
 */
export interface DeputationMoneyTerms {
  payOption: string | null;
  stationType: string | null;
  parentPayLevel: number | null;
  parentBasicMinor: string | null;
  postPayLevel: number | null;
  postBasicMinor: string | null;
  allowanceMode: string;
  deputationAllowanceMinor: string;
  daSource: string;
  parentDaRateBps: number | null;
  parentPensionScheme: string | null;
}

export const DEPUTATION_MONEY_FIELDS = [
  "payOption", "stationType", "parentPayLevel", "parentBasicMinor", "postPayLevel", "postBasicMinor",
  "allowanceMode", "deputationAllowanceMinor", "daSource", "parentDaRateBps", "parentPensionScheme",
] as const satisfies ReadonlyArray<keyof DeputationMoneyTerms>;

export function moneyTermsOf(d: DeputationTerms): DeputationMoneyTerms {
  return {
    payOption: d.payOption,
    stationType: d.stationType,
    parentPayLevel: d.parentPayLevel,
    parentBasicMinor: d.parentBasicMinor == null ? null : d.parentBasicMinor.toString(),
    postPayLevel: d.postPayLevel,
    postBasicMinor: d.postBasicMinor == null ? null : d.postBasicMinor.toString(),
    allowanceMode: d.allowanceMode,
    deputationAllowanceMinor: d.deputationAllowanceMinor.toString(),
    daSource: d.daSource,
    parentDaRateBps: d.parentDaRateBps,
    parentPensionScheme: d.parentPensionScheme,
  };
}

/** The deputation as payroll must see it under a profile: live identity/tenure, approved money terms. */
export function applyMoneyTerms(d: DeputationTerms, t: DeputationMoneyTerms): DeputationTerms {
  return {
    ...d,
    payOption: t.payOption,
    stationType: t.stationType,
    parentPayLevel: t.parentPayLevel,
    parentBasicMinor: t.parentBasicMinor == null ? null : BigInt(t.parentBasicMinor),
    postPayLevel: t.postPayLevel,
    postBasicMinor: t.postBasicMinor == null ? null : BigInt(t.postBasicMinor),
    allowanceMode: t.allowanceMode,
    deputationAllowanceMinor: BigInt(t.deputationAllowanceMinor),
    daSource: t.daSource,
    parentDaRateBps: t.parentDaRateBps,
    parentPensionScheme: t.parentPensionScheme,
  };
}

/** Money fields whose value differs between two term sets (for the lock + audit). */
export function changedMoneyFields(before: DeputationMoneyTerms, after: DeputationMoneyTerms): Array<keyof DeputationMoneyTerms> {
  return DEPUTATION_MONEY_FIELDS.filter((k) => before[k] !== after[k]);
}

export function isPayProfile(v: string): v is PayProfile {
  return (PAY_PROFILES as readonly string[]).includes(v);
}

/** First and last calendar day (YYYY-MM-DD) of a YYYY-MM month. */
export function monthBounds(month: string): { start: string; end: string } {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { start: `${month}-01`, end: `${month}-${String(last).padStart(2, "0")}` };
}

/** The calendar day before a YYYY-MM-DD date. */
export function dayBefore(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * The approved profile row that governs `month`, anchored on the 1st -- or on
 * the joining date when the employee joined during the month (the days before
 * joining are unpaid anyway, via payroll's joining pro-ration). v1 pays a
 * whole month under one profile; `changedWithinMonth` flags any other active
 * row starting/ending inside the month so payroll's preflight can warn.
 */
export function resolveProfileForMonth(
  rows: readonly PayProfileRow[],
  month: string,
  dateOfJoining: string | null,
): { row: PayProfileRow | null; changedWithinMonth: boolean } {
  const { start, end } = monthBounds(month);
  const anchor = dateOfJoining && dateOfJoining > start && dateOfJoining <= end ? dateOfJoining : start;
  const active = rows.filter((r) => r.status === "active");
  const covers = (r: PayProfileRow): boolean => r.effectiveFrom <= anchor && (r.effectiveTo == null || r.effectiveTo >= anchor);
  const row = active.find(covers) ?? null;
  const changedWithinMonth = active.some((r) =>
    (r.effectiveFrom > anchor && r.effectiveFrom <= end) ||
    (r.effectiveTo != null && r.effectiveTo >= anchor && r.effectiveTo < end),
  );
  return { row, changedWithinMonth };
}

export interface DeputationFeed {
  id: string;
  status: string;
  direction: "in" | "out";
  option: "parent_scale" | "post_scale" | null;
  stationType: "same" | "other" | null;
  parentCadre: string;
  parentOrganisation: string | null;
  parentPayLevel: number | null;
  parentBasicMinor: string | null;
  postPayLevel: number | null;
  postBasicMinor: string | null;
  allowanceMode: "auto" | "fixed";
  fixedAllowanceMinor: string;
  foreignService: boolean;
  parentPensionScheme: "GPF" | "NPS" | "EPF" | null;
  daSource: "central" | "parent";
  parentDaRateBps: number | null;
  tenureFrom: string;
  tenureTo: string;
  repatriatedOn: string | null;
}

export interface PayProfileFeed {
  profile: PayProfile;
  source: "assigned" | "default";
  profileId: string | null;
  effectiveFrom: string | null;
  consolidatedMonthlyMinor?: string;
  changedWithinMonth: boolean;
  deputation?: DeputationFeed;
}

export function toDeputationFeed(d: DeputationTerms): DeputationFeed {
  return {
    id: d.id,
    status: d.status,
    direction: d.direction === "in" ? "in" : "out",
    option: d.payOption === "parent_scale" || d.payOption === "post_scale" ? d.payOption : null,
    stationType: d.stationType === "same" || d.stationType === "other" ? d.stationType : null,
    parentCadre: d.parentCadre,
    parentOrganisation: d.parentOrganisation,
    parentPayLevel: d.parentPayLevel,
    parentBasicMinor: d.parentBasicMinor == null ? null : d.parentBasicMinor.toString(),
    postPayLevel: d.postPayLevel,
    postBasicMinor: d.postBasicMinor == null ? null : d.postBasicMinor.toString(),
    allowanceMode: d.allowanceMode === "fixed" ? "fixed" : "auto",
    fixedAllowanceMinor: d.deputationAllowanceMinor.toString(),
    foreignService: d.foreignService,
    parentPensionScheme: d.parentPensionScheme === "GPF" || d.parentPensionScheme === "NPS" || d.parentPensionScheme === "EPF"
      ? d.parentPensionScheme : null,
    daSource: d.daSource === "parent" ? "parent" : "central",
    parentDaRateBps: d.parentDaRateBps,
    tenureFrom: d.tenureFrom,
    tenureTo: d.tenureTo,
    repatriatedOn: d.repatriatedOn,
  };
}

/** Shape the payroll-input `payProfile` block from a resolved row. */
export function buildPayProfileFeed(
  resolved: { row: PayProfileRow | null; changedWithinMonth: boolean },
  deputation: DeputationTerms | null,
): PayProfileFeed {
  const { row, changedWithinMonth } = resolved;
  if (!row || !isPayProfile(row.payProfile)) {
    return { profile: "govt_scale", source: "default", profileId: null, effectiveFrom: null, changedWithinMonth };
  }
  const feed: PayProfileFeed = {
    profile: row.payProfile,
    source: "assigned",
    profileId: row.id,
    effectiveFrom: row.effectiveFrom,
    changedWithinMonth,
  };
  if (row.payProfile === "consolidated_contract" && row.consolidatedMonthlyMinor != null) {
    feed.consolidatedMonthlyMinor = row.consolidatedMonthlyMinor.toString();
  }
  // The APPROVED money terms (the profile's own copy), over the live
  // deputation's identity / status / tenure.
  if (DEPUTATION_PROFILES.has(row.payProfile) && deputation) {
    feed.deputation = toDeputationFeed(row.deputationTerms ? applyMoneyTerms(deputation, row.deputationTerms) : deputation);
  }
  return feed;
}

export const ADVISORIES = {
  consolidatedOnGovtScale: "CONSOLIDATED_ENGAGEMENT_ON_GOVT_SCALE",
  deputationistWithoutProfile: "DEPUTATIONIST_WITHOUT_DEPUTATION_PROFILE",
  deputationNotActiveForMonth: "DEPUTATION_PROFILE_BUT_DEPUTATION_NOT_ACTIVE",
  foreignService: "FOREIGN_SERVICE_DEPUTATION",
} as const;

/**
 * Advisory (never blocking, never auto-applied) hints that an employee's pay
 * profile looks inconsistent with their engagement/deputation. Profiles are
 * always explicit -- these drive an HR clean-up list, not a silent switch.
 */
export function payProfileAdvisories(input: {
  feed: PayProfileFeed;
  payMode: string;
  employeeType: string;
  activeDeputation: DeputationTerms | null;
  month: string;
}): string[] {
  const out: string[] = [];
  const { feed, payMode, employeeType, activeDeputation, month } = input;
  if (feed.profile === "govt_scale" && payMode === "consolidated") out.push(ADVISORIES.consolidatedOnGovtScale);
  const isDeputationist = employeeType === "deputation" || activeDeputation?.direction === "in";
  if (isDeputationist && !DEPUTATION_PROFILES.has(feed.profile)) out.push(ADVISORIES.deputationistWithoutProfile);
  if (feed.deputation) {
    const { start, end } = monthBounds(month);
    const covers = feed.deputation.tenureFrom <= end && feed.deputation.tenureTo >= start;
    if (feed.deputation.status !== "active" || !covers) out.push(ADVISORIES.deputationNotActiveForMonth);
    if (feed.deputation.foreignService) out.push(ADVISORIES.foreignService);
  }
  return out;
}

/**
 * Validate a requested profile assignment. Returns an error code, or null when
 * the request is acceptable. `lockedThrough` is the latest YYYY-MM with an
 * approved/disbursed payroll run (from payroll-service) -- a profile may not
 * start on or before a locked period.
 */
export function validateProfileRequest(input: {
  payProfile: PayProfile;
  effectiveFrom: string;
  employeeId: string;
  eligibleForPayroll: boolean;
  paymentRoute: string;
  deputation: DeputationTerms | null;
  deputationIdGiven: boolean;
  consolidatedMonthlyMinor: bigint | null;
  lockedThrough: string | null;
}): string | null {
  const { payProfile, effectiveFrom, eligibleForPayroll, paymentRoute, deputation } = input;
  if (!/^\d{4}-\d{2}-01$/.test(effectiveFrom)) return "EFFECTIVE_FROM_NOT_MONTH_START";
  if (input.lockedThrough && effectiveFrom.slice(0, 7) <= input.lockedThrough) return "PERIOD_LOCKED";
  if (!eligibleForPayroll || paymentRoute.toLowerCase() !== "payroll") return "PROFILE_ENGAGEMENT_MISMATCH";

  const option = requiredPayOption(payProfile);
  if (option) {
    if (!deputation) return "DEPUTATION_NOT_FOUND";
    if (deputation.employeeId !== input.employeeId) return "DEPUTATION_NOT_FOUND";
    if (deputation.status !== "active") return "DEPUTATION_NOT_ACTIVE";
    if (deputation.payOption !== option) return "DEPUTATION_OPTION_MISMATCH";
    const termsError = deputationTermsError(deputation);
    if (termsError) return termsError;
  } else if (input.deputationIdGiven) {
    return "DEPUTATION_ID_NOT_APPLICABLE";
  }

  if (payProfile === "consolidated_contract") {
    if (input.consolidatedMonthlyMinor == null || input.consolidatedMonthlyMinor <= 0n) return "CONSOLIDATED_AMOUNT_REQUIRED";
  } else if (input.consolidatedMonthlyMinor != null) {
    return "CONSOLIDATED_AMOUNT_NOT_APPLICABLE";
  }
  return null;
}

/**
 * Completeness of a deputation's pay terms for the option it carries.
 * Option A needs a station type (it selects the allowance % and cap) and a
 * parent basic for a deputed-IN employee (whose HRMS basic is not the parent
 * scale); Option B needs the post basic. Parent-State DA needs a rate.
 */
export function deputationTermsError(d: Pick<DeputationTerms,
  "payOption" | "stationType" | "direction" | "parentBasicMinor" | "postBasicMinor" | "daSource" | "parentDaRateBps">): string | null {
  if (d.daSource === "parent" && d.parentDaRateBps == null) return "PARENT_DA_RATE_REQUIRED";
  if (d.payOption === "parent_scale") {
    if (!d.stationType) return "STATION_TYPE_REQUIRED";
    if (d.direction === "in" && d.parentBasicMinor == null) return "PARENT_BASIC_REQUIRED";
  }
  if (d.payOption === "post_scale" && d.postBasicMinor == null) return "POST_BASIC_REQUIRED";
  return null;
}

/**
 * Plan the approval of a pending row against the employee's ACTIVE rows:
 * the new row must start after every active row's start, and the currently
 * open active row (if any) is closed the day before. Pure.
 */
export function planApproval(
  pending: Pick<PayProfileRow, "id" | "effectiveFrom">,
  activeRows: ReadonlyArray<Pick<PayProfileRow, "id" | "effectiveFrom" | "effectiveTo">>,
): { error: string } | { closeRowId: string | null; closeOn: string | null } {
  for (const r of activeRows) {
    if (r.effectiveFrom >= pending.effectiveFrom) return { error: "PROFILE_EFFECTIVE_NOT_AFTER_CURRENT" };
    if (r.effectiveTo != null && r.effectiveTo >= pending.effectiveFrom) return { error: "PROFILE_EFFECTIVE_NOT_AFTER_CURRENT" };
  }
  const open = activeRows.find((r) => r.effectiveTo == null) ?? null;
  return open ? { closeRowId: open.id, closeOn: dayBefore(pending.effectiveFrom) } : { closeRowId: null, closeOn: null };
}
