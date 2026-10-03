import type { CompetencyScore } from "./_components/CompetencyRadarChart";

/**
 * GAP-HR-COMPETENCY-01: the radar used to be a hard-coded SAMPLE next to real
 * framework counts. It now shows the VIEWER'S OWN recorded competency levels
 * (GET .../competency/employees/:id/profile) against each competency's
 * certified level (an attribute of the competency definition, not an
 * invented baseline). Pure helpers, no I/O.
 */
export type CompetencyDef = { id: string; name: string; maxLevel?: number; certifiedLevel?: number } & Record<string, unknown>;
export type HeldLevel = { competencyId: string; currentLevel: number } & Record<string, unknown>;

/** A radar needs >= 3 axes to be a shape; more than 8 is unreadable. */
export const MIN_RADAR_AXES = 3;
export const MAX_RADAR_AXES = 8;

export interface MyRadar {
  scores: CompetencyScore[];
  /** Top of the chart's scale: the largest max level among the plotted competencies (>= 5). */
  maxValue: number;
}

export function buildMyRadar(held: HeldLevel[], defs: CompetencyDef[]): MyRadar {
  const byId = new Map(defs.map((d) => [d.id, d]));
  const rows = held
    .map((h) => ({ h, d: byId.get(h.competencyId) }))
    .filter((x): x is { h: HeldLevel; d: CompetencyDef } => !!x.d)
    .sort((a, b) => b.h.currentLevel - a.h.currentLevel || a.d.name.localeCompare(b.d.name))
    .slice(0, MAX_RADAR_AXES);
  const scores = rows.map(({ h, d }) => ({
    label: d.name,
    current: h.currentLevel,
    required: d.certifiedLevel ?? 0,
  }));
  const maxValue = Math.max(5, ...rows.map(({ d }) => d.maxLevel ?? 5));
  return { scores, maxValue };
}

export function hasEnoughForRadar(radar: MyRadar): boolean {
  return radar.scores.length >= MIN_RADAR_AXES;
}
