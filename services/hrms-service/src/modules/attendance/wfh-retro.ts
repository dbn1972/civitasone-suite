/**
 * GAP-HR-WFH-06 (owner decision, 26 Nov 2026): retrospective WFH.
 *
 *   - an employee filing for themselves may NOT back-date: fromDate must be
 *     today (IST) or later;
 *   - HR staff may record a WFH day that has already started, up to
 *     WFH_RETRO_MAX_DAYS calendar days back, and must give a reason (it lands
 *     on the request row and in the audit trail).
 *
 * Pure (no DB / clock): the caller passes today's IST date so it is testable.
 */
import { addDays } from "@civitasone/schemas/validators";

/** How far back HR may record a WFH day. */
export const WFH_RETRO_MAX_DAYS = 7;
/** Minimum characters of reason HR must give for a back-dated entry. */
export const WFH_RETRO_MIN_REASON = 10;

export interface WfhRetroRefusal {
  code: "RETROSPECTIVE_WFH_NOT_ALLOWED" | "RETROSPECTIVE_WFH_WINDOW_EXCEEDED" | "RETROSPECTIVE_WFH_REASON_REQUIRED";
  message: string;
}

export function wfhRetrospectiveRefusal(args: {
  fromDate: string;
  todayIst: string;
  actorIsHr: boolean;
  reason: string | undefined;
}): WfhRetroRefusal | null {
  const { fromDate, todayIst, actorIsHr, reason } = args;
  if (fromDate >= todayIst) return null;
  if (!actorIsHr) {
    return {
      code: "RETROSPECTIVE_WFH_NOT_ALLOWED",
      message: "work from home cannot be requested for a past date; ask HR to record it",
    };
  }
  const earliest = addDays(todayIst, -WFH_RETRO_MAX_DAYS);
  if (fromDate < earliest) {
    return {
      code: "RETROSPECTIVE_WFH_WINDOW_EXCEEDED",
      message: `HR may record work from home at most ${WFH_RETRO_MAX_DAYS} days back (earliest ${earliest})`,
    };
  }
  if ((reason ?? "").trim().length < WFH_RETRO_MIN_REASON) {
    return {
      code: "RETROSPECTIVE_WFH_REASON_REQUIRED",
      message: `a back-dated work-from-home entry needs a reason of at least ${WFH_RETRO_MIN_REASON} characters`,
    };
  }
  return null;
}
