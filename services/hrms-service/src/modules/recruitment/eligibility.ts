/**
 * Recruitment application eligibility engine (pure). Evaluates an applicant
 * against a vacancy's advertised eligibility criteria — age as on the advertised
 * cut-off date with category-wise relaxation, minimum experience, and permitted
 * qualifications — and returns an explainable, per-rule result (checklist
 * R-RA-0093/0094/0095). No I/O, no Date.now.
 */

export interface EligibilityCriteria {
  ageMin?: number;
  ageMax?: number;
  cutoffDate?: string;                          // "as on" date, YYYY-MM-DD
  experienceMinYears?: number;
  allowedQualifications?: string[];             // case-insensitive membership
  categoryAgeRelaxation?: Record<string, number>; // category -> extra years on ageMax (SC/ST 5, OBC 3, PwD 10, …)
  allowMultiple?: boolean;                       // may a candidate apply more than once
}

export interface Applicant {
  dateOfBirth?: string; // YYYY-MM-DD
  category?: string;
  experienceYears?: number;
  qualification?: string;
}

export interface EligibilityCheck { rule: string; ok: boolean; detail: string; }
export interface EligibilityResult {
  eligible: boolean;
  ageAtCutoff: number | null;
  effectiveMaxAge: number | null;
  checks: EligibilityCheck[];
}

/** True only for a real calendar date in YYYY-MM-DD form (rejects 2026-02-30). */
export function isValidCalendarDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

/** Completed years from `dob` to `cutoff` (both YYYY-MM-DD). */
export function ageOn(dob: string, cutoff: string): number {
  const b = dob.split("-").map(Number);
  const c = cutoff.split("-").map(Number);
  const by = b[0] ?? 0, bm = b[1] ?? 0, bd = b[2] ?? 0;
  const cy = c[0] ?? 0, cm = c[1] ?? 0, cd = c[2] ?? 0;
  let age = cy - by;
  if (cm < bm || (cm === bm && cd < bd)) age -= 1;
  return age;
}

/** ageMax plus the category's relaxation years (0 if none configured). */
export function effectiveMaxAge(ageMax: number, category: string | undefined, relaxation: Record<string, number> | undefined): number {
  const extra = category && relaxation ? (relaxation[category] ?? 0) : 0;
  return ageMax + extra;
}

export function evaluateEligibility(c: EligibilityCriteria, a: Applicant): EligibilityResult {
  const checks: EligibilityCheck[] = [];
  let ageAtCutoff: number | null = null;
  let effMax: number | null = null;

  const hasAgeRule = c.ageMin != null || c.ageMax != null;
  if (hasAgeRule) {
    if (!c.cutoffDate) {
      checks.push({ rule: "age", ok: true, detail: "age not evaluated — no advertised cut-off date configured" });
    } else if (!a.dateOfBirth) {
      checks.push({ rule: "age", ok: false, detail: "date of birth is required to verify age eligibility" });
    } else {
      ageAtCutoff = ageOn(a.dateOfBirth, c.cutoffDate);
      if (c.ageMin != null && ageAtCutoff < c.ageMin) {
        checks.push({ rule: "age_min", ok: false, detail: `age ${ageAtCutoff} is below the minimum ${c.ageMin} as on ${c.cutoffDate}` });
      }
      if (c.ageMax != null) {
        effMax = effectiveMaxAge(c.ageMax, a.category, c.categoryAgeRelaxation);
        const relaxed = effMax > c.ageMax ? ` (relaxed to ${effMax} for category ${a.category})` : "";
        if (ageAtCutoff > effMax) {
          checks.push({ rule: "age_max", ok: false, detail: `age ${ageAtCutoff} exceeds the maximum ${c.ageMax}${relaxed} as on ${c.cutoffDate}` });
        } else {
          checks.push({ rule: "age_max", ok: true, detail: `age ${ageAtCutoff} within maximum ${effMax}${relaxed}` });
        }
      }
      if (c.ageMin != null && ageAtCutoff >= c.ageMin) {
        checks.push({ rule: "age_min", ok: true, detail: `age ${ageAtCutoff} meets the minimum ${c.ageMin}` });
      }
    }
  }

  if (c.experienceMinYears != null) {
    const exp = a.experienceYears ?? 0;
    checks.push({
      rule: "experience",
      ok: exp >= c.experienceMinYears,
      detail: `experience ${exp}y vs minimum ${c.experienceMinYears}y`,
    });
  }

  if (c.allowedQualifications && c.allowedQualifications.length > 0) {
    const allowed = c.allowedQualifications.map((q) => q.trim().toLowerCase());
    if (!a.qualification) {
      checks.push({ rule: "qualification", ok: false, detail: "qualification is required for this vacancy" });
    } else {
      const ok = allowed.includes(a.qualification.trim().toLowerCase());
      checks.push({ rule: "qualification", ok, detail: ok ? `qualification '${a.qualification}' is permitted` : `qualification '${a.qualification}' is not in the permitted list` });
    }
  }

  return {
    eligible: checks.every((k) => k.ok),
    ageAtCutoff,
    effectiveMaxAge: effMax,
    checks,
  };
}
