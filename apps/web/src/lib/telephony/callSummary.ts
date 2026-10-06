/**
 * Shared telephony call-list summary maths.
 *
 * GAP-TELEPHONY-HOME-03 / CALLS-01 / CALLS-02: the Call Log page and the
 * Telephony hub's live-status strip both derive the same figures (live /
 * answered / abandoned / SLA%) from the /v1/telephony/calls list. Keeping the
 * calculation in one pure, unit-tested place means the hub can never disagree
 * with the Call Log, and the SLA figure is computed honestly: when no call has
 * an SLA result the SLA percentage is `null` (render "—"), never a reassuring
 * fabricated 100%.
 */

/** The subset of a call row this summary needs. */
export type CallSummaryInput = {
  status: string;
  abandoned: boolean;
  slaAnswered: boolean | null;
};

export type CallSummary = {
  total: number;
  /** queued or ringing — calls currently waiting/in progress. */
  live: number;
  /** answered or completed. */
  answered: number;
  abandoned: number;
  /** number of calls that carry an SLA result (slaAnswered !== null). */
  slaScored: number;
  slaMet: number;
  /**
   * Whole-percent SLA attainment over scored calls, or null when nothing is
   * scored. Null MUST render as "—", not 0 and not 100 — an empty or unscored
   * log is not a perfect score.
   */
  slaPct: number | null;
};

export function summariseCalls(calls: readonly CallSummaryInput[]): CallSummary {
  let live = 0;
  let answered = 0;
  let abandoned = 0;
  let slaScored = 0;
  let slaMet = 0;
  for (const c of calls) {
    if (c.status === "queued" || c.status === "ringing") live += 1;
    if (c.status === "answered" || c.status === "completed") answered += 1;
    if (c.abandoned) abandoned += 1;
    if (c.slaAnswered !== null) {
      slaScored += 1;
      if (c.slaAnswered === true) slaMet += 1;
    }
  }
  return {
    total: calls.length,
    live,
    answered,
    abandoned,
    slaScored,
    slaMet,
    slaPct: slaScored > 0 ? Math.round((slaMet / slaScored) * 100) : null,
  };
}
