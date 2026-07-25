/**
 * Manpower-planning domain — pure logic, no I/O. (SVC-003)
 *
 * A manpower plan is stated per (unit, cadre, plan_year) as three head-counts:
 *   required   — what the planners say the unit needs
 *   sanctioned — sanctioned posts (the funded ceiling)
 *   filled     — currently on-roll (grows as recruitment hires land)
 *
 * The recruitable vacancy is bounded by the SANCTIONED ceiling, never by the
 * (aspirational) required figure — you cannot recruit against unsanctioned
 * posts. `deficitVsRequired` is reported separately so planners can see the gap
 * they should seek fresh sanction for.
 */

export interface PlanStrength {
  requiredStrength: number;
  sanctionedStrength: number;
  filledStrength: number;
}

export interface VacancyComputation {
  /** Recruitable vacancy: max(0, sanctioned − filled). */
  vacancy: number;
  /** Posts filled beyond sanction (over-strength): max(0, filled − sanctioned). */
  surplus: number;
  /** Shortfall of sanction vs the planners' requirement: max(0, required − sanctioned). */
  deficitVsRequired: number;
  /** Sanctioned utilisation %, 0..100 (0 when nothing is sanctioned). */
  fillRatePct: number;
}

export function computeVacancy(p: PlanStrength): VacancyComputation {
  const sanctioned = Math.max(0, Math.trunc(p.sanctionedStrength));
  const filled = Math.max(0, Math.trunc(p.filledStrength));
  const required = Math.max(0, Math.trunc(p.requiredStrength));

  const vacancy = Math.max(0, sanctioned - filled);
  const surplus = Math.max(0, filled - sanctioned);
  const deficitVsRequired = Math.max(0, required - sanctioned);
  const fillRatePct = sanctioned === 0 ? 0 : Math.round((filled / sanctioned) * 10000) / 100;

  return { vacancy, surplus, deficitVsRequired, fillRatePct };
}

// ── Reservation-roster allocation ──────────────────────────────────

export type RosterCategory = "SC" | "ST" | "OBC" | "EWS" | "UR" | "PwD";

export interface RosterPercentages {
  pctSc: number;
  pctSt: number;
  pctObc: number;
  pctEws: number;
  pctPwd: number; // horizontal — reported as a count, NOT subtracted from UR
}

export interface RosterAllocationRow {
  category: RosterCategory;
  reservedCount: number;
  horizontal?: boolean;
}

export interface RosterAllocation {
  total: number;
  rows: RosterAllocationRow[];
}

export const DEFAULT_ROSTER: RosterPercentages = {
  pctSc: 15,
  pctSt: 7.5,
  pctObc: 27,
  pctEws: 10,
  pctPwd: 4,
};

/**
 * Allocate a whole number of vacancies across the vertical reservation
 * categories (SC/ST/OBC/EWS) and the unreserved (UR) remainder. PwD is a
 * HORIZONTAL reservation cutting across all verticals, so it is reported as a
 * separate count and NOT deducted from UR.
 *
 * Vertical counts round to the nearest whole point; UR absorbs the balance so
 * the vertical rows + UR always sum EXACTLY to `total` (never over/under).
 */
export function allocateRoster(total: number, pct: RosterPercentages = DEFAULT_ROSTER): RosterAllocation {
  const n = Math.max(0, Math.trunc(total));

  const sc = Math.round((pct.pctSc / 100) * n);
  const st = Math.round((pct.pctSt / 100) * n);
  const obc = Math.round((pct.pctObc / 100) * n);
  const ews = Math.round((pct.pctEws / 100) * n);
  const reserved = sc + st + obc + ews;
  const ur = Math.max(0, n - reserved);
  const pwd = Math.round((pct.pctPwd / 100) * n);

  return {
    total: n,
    rows: [
      { category: "SC", reservedCount: sc },
      { category: "ST", reservedCount: st },
      { category: "OBC", reservedCount: obc },
      { category: "EWS", reservedCount: ews },
      { category: "UR", reservedCount: ur },
      { category: "PwD", reservedCount: pwd, horizontal: true },
    ],
  };
}

// ── Maker-checker guard (pure) ─────────────────────────────────────

/**
 * A plan may be approved only by a checker who is NOT its creator (maker),
 * and only while it is awaiting approval.
 */
export function canApprove(
  plan: { status: string; createdBy: string },
  approverId: string,
): { ok: true } | { ok: false; code: "MAKER_CHECKER" | "INVALID_STATE"; message: string } {
  if (plan.createdBy === approverId) {
    return { ok: false, code: "MAKER_CHECKER", message: "plan approval requires a checker different from the plan creator" };
  }
  if (plan.status !== "pending_approval") {
    return { ok: false, code: "INVALID_STATE", message: "only a plan pending approval can be approved" };
  }
  return { ok: true };
}
