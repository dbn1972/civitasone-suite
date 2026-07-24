/**
 * SVC-124 — competency & skill management: pure, DB-free domain logic.
 */

export interface RequiredCompetency {
  competencyId: string;
  requiredLevel: number;
}

export interface GapRow {
  competencyId: string;
  requiredLevel: number;
  heldLevel: number;
  gap: number;   // required - held, floored at 0
  met: boolean;  // heldLevel >= requiredLevel
}

export interface GapAnalysis {
  rows: GapRow[];
  requiredCount: number;
  metCount: number;
  gapCount: number;
  readinessPct: number; // metCount / requiredCount * 100, rounded
}

/**
 * Gap analysis: required competencies (for a role) vs the levels the employee
 * holds. A missing held competency counts as level 0.
 */
export function analyzeGaps(
  required: RequiredCompetency[],
  held: Map<string, number>,
): GapAnalysis {
  const rows: GapRow[] = required.map((r) => {
    const heldLevel = held.get(r.competencyId) ?? 0;
    const met = heldLevel >= r.requiredLevel;
    const gap = met ? 0 : r.requiredLevel - heldLevel;
    return { competencyId: r.competencyId, requiredLevel: r.requiredLevel, heldLevel, gap, met };
  });
  const requiredCount = rows.length;
  const metCount = rows.filter((r) => r.met).length;
  const gapCount = requiredCount - metCount;
  const readinessPct = requiredCount === 0 ? 100 : Math.round((metCount / requiredCount) * 100);
  return { rows, requiredCount, metCount, gapCount, readinessPct };
}

/**
 * The proficiency level a certificate certifies for a competency. We take the
 * competency's configured certifiedLevel, never exceeding its maxLevel.
 */
export function resolveCertifiedLevel(competency: { certifiedLevel: number; maxLevel: number }): number {
  return Math.min(competency.certifiedLevel, competency.maxLevel);
}

/**
 * When applying new evidence to a held competency, never regress a higher
 * existing level: the effective level is the max of the current and incoming.
 */
export function mergeLevel(currentLevel: number, incomingLevel: number): number {
  return Math.max(currentLevel, incomingLevel);
}
