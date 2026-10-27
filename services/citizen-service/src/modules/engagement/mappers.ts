import type { CitizenAlertRow, CitizenNoticeRow, CitizenSurveyRow } from "./schema.js";

/**
 * Wire shapes the web screens consume (apps/web/src/app/_data/loaders.ts:
 * CitizenAlert / CitizenNotice, apps/web/src/lib/citizenSurveys.ts:
 * CitizenSurvey). Mirrored by CitizenAlertSchema / CitizenNoticeSchema /
 * CitizenSurveySchema in @civitasone/schemas/web — tests/engagement-web-contract
 * feeds the real route output through those schemas. Dates are ISO strings;
 * an absent date is "" (the screens' date cells render "—" for empty).
 */
export interface CitizenAlertDto {
  id: string; title: string; category: string; publishedDate: string; targetAudience: string; status: string;
}
export interface CitizenNoticeDto {
  id: string; noticeNo: string; subject: string; department: string; published: string; expiry: string; type: string;
  /** Stored lifecycle status (draft | published | withdrawn) so officers can act on a row; citizens only ever receive "published". */
  status: string;
}
export interface CitizenSurveyDto {
  id: string; surveyName: string; responses: number; completion: string; period: string; status: string;
}

const iso = (d: Date | null | undefined): string => (d ? d.toISOString() : "");

/** "expired" is derived from expires_at and never stored: a stored-active alert past expiry reads as expired. */
export function alertDisplayStatus(row: Pick<CitizenAlertRow, "status" | "expiresAt">, now: Date = new Date()): string {
  if (row.status === "active" && row.expiresAt && row.expiresAt.getTime() <= now.getTime()) return "expired";
  return row.status;
}

export function toAlertDto(row: CitizenAlertRow, now: Date = new Date()): CitizenAlertDto {
  return {
    id: row.id, title: row.title, category: row.category,
    publishedDate: iso(row.publishedAt), targetAudience: row.targetAudience,
    status: alertDisplayStatus(row, now),
  };
}

export const NOTICE_TYPE_LABELS: Record<string, string> = {
  statutory: "Statutory", public_hearing: "Public Hearing", tender: "Tender", general: "General",
};

export function toNoticeDto(row: CitizenNoticeRow): CitizenNoticeDto {
  return {
    id: row.id, noticeNo: row.noticeNo, subject: row.subject, department: row.department,
    published: iso(row.publishedAt), expiry: iso(row.expiresAt),
    type: NOTICE_TYPE_LABELS[row.noticeType] ?? row.noticeType,
    status: row.status,
  };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function fmtDay(day: string): string {
  const [y, m, d] = day.split("-");
  return `${d} ${MONTHS[Number(m) - 1] ?? m} ${y}`;
}

export function formatSurveyPeriod(startsOn: string | null, endsOn: string | null): string {
  if (startsOn && endsOn) return `${fmtDay(startsOn)} – ${fmtDay(endsOn)}`;
  if (startsOn) return `From ${fmtDay(startsOn)}`;
  if (endsOn) return `Until ${fmtDay(endsOn)}`;
  return "";
}

/** completion = responses / targetResponses as "NN%" (capped at 100); "—" when no target is set. */
export function formatCompletion(responses: number, target: number | null): string {
  if (!target || target <= 0) return "—";
  return `${Math.min(100, Math.round((responses / target) * 100))}%`;
}

export function toSurveyDto(row: CitizenSurveyRow, responses: number): CitizenSurveyDto {
  return {
    id: row.id, surveyName: row.surveyName, responses,
    completion: formatCompletion(responses, row.targetResponses),
    period: formatSurveyPeriod(row.startsOn, row.endsOn),
    status: row.status,
  };
}
