/**
 * Reservation roster engine (post-based, e.g. 100-point roster). Pure logic.
 *
 * Vertical reservation (SC/ST/OBC/EWS) is applied as a percentage of the roster
 * size; the unreserved (UR) balance is whatever remains. PwD is a HORIZONTAL
 * reservation (cuts across all vertical categories) and is therefore reported
 * separately as a count, not subtracted from UR.
 *
 * Category-wise vacancy for a recruitment cycle:
 *   entitlement(category) = round(pct/100 * roster_size) + carry_forward(category)
 *   vacancy(category)     = max(0, entitlement - already_filled(category))
 *
 * Carry-forward is added on top of the current entitlement (backlog vacancies
 * from earlier cycles). UR carry-forward is supported for completeness.
 */

export type Category = "SC" | "ST" | "OBC" | "EWS" | "UR" | "PwD";

export interface RosterDef {
  rosterSize: number;
  pctSc: number;
  pctSt: number;
  pctObc: number;
  pctEws: number;
  pctPwd: number; // horizontal
  cf: { SC: number; ST: number; OBC: number; EWS: number; UR: number };
}

export interface FilledByCategory {
  SC: number; ST: number; OBC: number; EWS: number; UR: number;
}

export interface CategoryComputation {
  category: Category;
  pct: number;
  entitlement: number; // vertical reservation for this cycle (incl. carry-forward)
  carryForward: number;
  filled: number;
  vacancy: number;
  horizontal?: boolean;
}

export interface RosterComputation {
  rosterSize: number;
  categories: CategoryComputation[];
  totals: { entitlement: number; filled: number; vacancy: number };
  pwd: { entitlement: number; note: string };
}

function entitlementFor(pct: number, size: number): number {
  // Standard roster rounding: round to nearest whole point.
  return Math.round((pct / 100) * size);
}

export function computeRoster(def: RosterDef, filled: FilledByCategory): RosterComputation {
  const vertical: Array<{ cat: Exclude<Category, "PwD" | "UR">; pct: number; cf: number; filled: number }> = [
    { cat: "SC", pct: def.pctSc, cf: def.cf.SC, filled: filled.SC },
    { cat: "ST", pct: def.pctSt, cf: def.cf.ST, filled: filled.ST },
    { cat: "OBC", pct: def.pctObc, cf: def.cf.OBC, filled: filled.OBC },
    { cat: "EWS", pct: def.pctEws, cf: def.cf.EWS, filled: filled.EWS },
  ];

  const categories: CategoryComputation[] = [];
  let reservedEntitlement = 0;

  for (const v of vertical) {
    const ent = entitlementFor(v.pct, def.rosterSize) + v.cf;
    reservedEntitlement += entitlementFor(v.pct, def.rosterSize);
    const vac = Math.max(0, ent - v.filled);
    categories.push({
      category: v.cat, pct: v.pct, entitlement: ent, carryForward: v.cf,
      filled: v.filled, vacancy: vac,
    });
  }

  // UR = roster_size - sum(vertical reserved entitlements), plus any UR backlog.
  const urEnt = Math.max(0, def.rosterSize - reservedEntitlement) + def.cf.UR;
  const urVac = Math.max(0, urEnt - filled.UR);
  categories.push({
    category: "UR", pct: 0, entitlement: urEnt, carryForward: def.cf.UR,
    filled: filled.UR, vacancy: urVac,
  });

  const totals = categories.reduce(
    (acc, c) => ({
      entitlement: acc.entitlement + c.entitlement,
      filled: acc.filled + c.filled,
      vacancy: acc.vacancy + c.vacancy,
    }),
    { entitlement: 0, filled: 0, vacancy: 0 });

  const pwdEnt = entitlementFor(def.pctPwd, def.rosterSize);

  return {
    rosterSize: def.rosterSize,
    categories,
    totals,
    pwd: {
      entitlement: pwdEnt,
      note: "PwD is a horizontal reservation cutting across all vertical categories; these posts are accommodated WITHIN the vertical category counts, not added to total strength.",
    },
  };
}

/**
 * Generate the standard point allocation for a roster of the given size using
 * the canonical L-shaped roster rule of thumb derived from the percentages:
 * point N belongs to a reserved category when floor(N * pct/100) increments at
 * that point. Returns one category per point (1..size). PwD is horizontal and
 * not assigned here.
 */
export function generateRosterPoints(def: Pick<RosterDef, "rosterSize" | "pctSc" | "pctSt" | "pctObc" | "pctEws">): Array<{ point: number; category: Exclude<Category, "PwD"> }> {
  const size = def.rosterSize;
  // M4: validate Σ reserved pct ≤ 100 so the roster can never over-allocate.
  const total = def.pctSc + def.pctSt + def.pctObc + def.pctEws;
  if (total > 100) {
    throw new Error(
      `reserved percentages sum to ${total}% (> 100%): SC=${def.pctSc} ST=${def.pctSt} OBC=${def.pctObc} EWS=${def.pctEws}`,
    );
  }
  // M4: the old if/else-if dropped a category's point whenever two categories
  // would increment on the same point (undercount). We instead guarantee the
  // exact per-category point total (floor(pct% of size)) and spread points by a
  // deficit-greedy walk: at each point pick the category furthest behind its
  // ideal cumulative share, so a collision-loser is simply placed at the next
  // point rather than dropped. Priority on ties: SC, ST, OBC, EWS.
  const ORDER = ["SC", "ST", "OBC", "EWS"] as const;
  const pct: Record<typeof ORDER[number], number> = {
    SC: def.pctSc, ST: def.pctSt, OBC: def.pctObc, EWS: def.pctEws,
  };
  // Exact target counts (floor); Σ targets ≤ size because Σpct ≤ 100.
  const target: Record<typeof ORDER[number], number> = {
    SC: Math.floor((size * def.pctSc) / 100),
    ST: Math.floor((size * def.pctSt) / 100),
    OBC: Math.floor((size * def.pctObc) / 100),
    EWS: Math.floor((size * def.pctEws) / 100),
  };
  const placed: Record<typeof ORDER[number], number> = { SC: 0, ST: 0, OBC: 0, EWS: 0 };
  const out: Array<{ point: number; category: Exclude<Category, "PwD"> }> = [];
  for (let n = 1; n <= size; n++) {
    // Among categories that still owe points, choose the one whose ideal
    // cumulative count by point n most exceeds what we've placed (largest
    // deficit). Ties broken by ORDER priority.
    let best: typeof ORDER[number] | null = null;
    let bestDeficit = 0;
    for (const c of ORDER) {
      if (placed[c] >= target[c]) continue;
      const ideal = (n * pct[c]) / 100;
      const deficit = ideal - placed[c];
      if (best === null || deficit > bestDeficit + 1e-9) {
        best = c;
        bestDeficit = deficit;
      }
    }
    if (best !== null && bestDeficit > 0) {
      placed[best] += 1;
      out.push({ point: n, category: best });
    } else {
      out.push({ point: n, category: "UR" });
    }
  }
  return out;
}
