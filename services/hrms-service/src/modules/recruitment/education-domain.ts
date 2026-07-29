/**
 * Education-validation domain (pure) — level, discipline and institution against a
 * job's requirement (R-RA-0109). No I/O.
 */

/** Ordered education levels; index is the rank used for "minimum level" checks. */
export const EDUCATION_LEVELS = [
  "below_10th", "10th", "12th", "iti", "diploma", "bachelor", "pg_diploma", "master", "mphil", "doctorate",
] as const;
export type EducationLevel = (typeof EDUCATION_LEVELS)[number];

function rank(level: string): number {
  return (EDUCATION_LEVELS as readonly string[]).indexOf((level || "").trim().toLowerCase());
}
const norm = (s: string | undefined | null) => (s || "").trim().toLowerCase();

export interface Qualification {
  level: string;
  discipline?: string;
  institution?: string;
  year?: number;
  percentage?: number;
}

export interface EducationRequirement {
  minLevel: string;                 // one of EDUCATION_LEVELS
  requiredDisciplines?: string[];   // any-of; matched at or above minLevel
  minPercentage?: number;           // on the qualifying degree
  recognisedInstitutionsOnly?: boolean; // if true, institution must be non-empty
}

export interface EducationResult {
  highestLevel: string | null;
  meetsLevel: boolean;
  meetsDiscipline: boolean;
  meetsPercentage: boolean;
  issues: string[];
  eligible: boolean;
}

/**
 * Validate qualifications against a requirement. Discipline (and percentage) are
 * checked on qualifications that are AT OR ABOVE the required level, so a candidate
 * can't satisfy a bachelor-in-CS requirement with a 12th-grade "CS" subject.
 */
export function validateEducation(quals: readonly Qualification[], req: EducationRequirement): EducationResult {
  const issues: string[] = [];
  const minRank = rank(req.minLevel);
  if (minRank < 0) issues.push(`unknown required level "${req.minLevel}"`);

  const ranked = quals.map((q) => ({ q, r: rank(q.level) }));
  const unknown = ranked.filter((x) => x.r < 0).map((x) => x.q.level);
  for (const u of unknown) issues.push(`unknown qualification level "${u}"`);

  const known = ranked.filter((x) => x.r >= 0);
  const highest = known.reduce<{ q: Qualification; r: number } | null>((best, x) => (!best || x.r > best.r ? x : best), null);
  const highestLevel = highest ? highest.q.level : null;

  const meetsLevel = minRank >= 0 && highest != null && highest.r >= minRank;
  if (!meetsLevel) issues.push("does not meet the minimum education level");

  // qualifications eligible to satisfy discipline/percentage: at or above minLevel
  const qualifying = known.filter((x) => minRank >= 0 && x.r >= minRank).map((x) => x.q);

  let meetsDiscipline = true;
  if (req.requiredDisciplines && req.requiredDisciplines.length > 0) {
    const want = new Set(req.requiredDisciplines.map(norm));
    meetsDiscipline = qualifying.some((q) => want.has(norm(q.discipline)));
    if (!meetsDiscipline) issues.push(`discipline not among required: ${req.requiredDisciplines.join(", ")}`);
  }

  let meetsPercentage = true;
  if (req.minPercentage != null) {
    // consider only qualifications that also satisfy the discipline constraint
    const pool = req.requiredDisciplines && req.requiredDisciplines.length > 0
      ? qualifying.filter((q) => new Set(req.requiredDisciplines!.map(norm)).has(norm(q.discipline)))
      : qualifying;
    meetsPercentage = pool.some((q) => q.percentage != null && q.percentage >= req.minPercentage!);
    if (!meetsPercentage) issues.push(`minimum percentage ${req.minPercentage} not met on the qualifying degree`);
  }

  let meetsInstitution = true;
  if (req.recognisedInstitutionsOnly) {
    meetsInstitution = qualifying.some((q) => norm(q.institution) !== "");
    if (!meetsInstitution) issues.push("institution details are required but missing");
  }

  return {
    highestLevel, meetsLevel, meetsDiscipline, meetsPercentage, issues,
    eligible: meetsLevel && meetsDiscipline && meetsPercentage && meetsInstitution && unknown.length === 0 && minRank >= 0,
  };
}
