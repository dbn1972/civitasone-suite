/** Qualitative probability x impact -> integer risk score (1..16). */
export function computeRiskScore(probability: string, impact: string): number {
  const levels: Record<string, number> = { low: 1, medium: 2, high: 3, critical: 4 };
  return (levels[probability] ?? 2) * (levels[impact] ?? 2);
}
