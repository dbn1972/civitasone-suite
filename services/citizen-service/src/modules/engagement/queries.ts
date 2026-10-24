import * as repo from "./repo.js";
import {
  toAlertDto, toNoticeDto, toSurveyDto,
  type CitizenAlertDto, type CitizenNoticeDto, type CitizenSurveyDto,
} from "./mappers.js";
import type { CitizenAlertRow, CitizenNoticeRow, CitizenSurveyRow, CitizenSurveyResponseRow } from "./schema.js";

/** What a bare citizen may see. Staff (officer tier) can see every state. */
export const PUBLIC_STATUSES = {
  alerts: ["active"],
  notices: ["published"],
  surveys: ["active", "completed"],
} as const;
export const ALL_STATUSES = {
  alerts: ["draft", "active", "withdrawn"],
  notices: ["draft", "published", "withdrawn"],
  surveys: ["draft", "active", "completed"],
} as const;
/** Staff default view: the notices screen cannot tell drafts apart, so it defaults to the public set. */
const STAFF_DEFAULT: Record<keyof typeof ALL_STATUSES, string[] | null> = {
  alerts: null, notices: ["published"], surveys: null,
};

export type Entity = keyof typeof ALL_STATUSES;

/** Resolves the stored-status filter: citizens are forced to the public set; staff may pick one or "all". */
export function resolveStatuses(entity: Entity, staff: boolean, requested?: string): string[] | null {
  if (!staff) return [...PUBLIC_STATUSES[entity]];
  if (!requested) return STAFF_DEFAULT[entity];
  if (requested === "all") return null;
  return [requested];
}

export async function listAlerts(tenantId: string, staff: boolean, q: { limit: number; offset: number; status?: string | undefined }): Promise<CitizenAlertDto[]> {
  const rows = await repo.listAlerts(tenantId, resolveStatuses("alerts", staff, q.status), q.limit, q.offset);
  const now = new Date();
  return rows.map((r) => toAlertDto(r, now));
}
export async function listNotices(tenantId: string, staff: boolean, q: { limit: number; offset: number; status?: string | undefined }): Promise<CitizenNoticeDto[]> {
  const rows = await repo.listNotices(tenantId, resolveStatuses("notices", staff, q.status), q.limit, q.offset);
  return rows.map(toNoticeDto);
}
export async function listSurveys(tenantId: string, staff: boolean, q: { limit: number; offset: number; status?: string | undefined }): Promise<CitizenSurveyDto[]> {
  const rows = await repo.listSurveys(tenantId, resolveStatuses("surveys", staff, q.status), q.limit, q.offset);
  const counts = await repo.countResponsesBySurvey(tenantId, rows.map((r) => r.id));
  return rows.map((r) => toSurveyDto(r, counts.get(r.id) ?? 0));
}

export const getAlert = (tenantId: string, id: string): Promise<CitizenAlertRow | null> => repo.findAlert(tenantId, id);
export const getNotice = (tenantId: string, id: string): Promise<CitizenNoticeRow | null> => repo.findNotice(tenantId, id);
export const getSurvey = (tenantId: string, id: string): Promise<CitizenSurveyRow | null> => repo.findSurvey(tenantId, id);
export const getNoticeByNo = (tenantId: string, no: string): Promise<CitizenNoticeRow | null> => repo.findNoticeByNo(tenantId, no);
export const getOwnResponse = (tenantId: string, surveyId: string, citizenId: string): Promise<CitizenSurveyResponseRow | null> =>
  repo.findOwnResponse(tenantId, surveyId, citizenId);
export const listResponses = (tenantId: string, surveyId: string, limit: number, offset: number): Promise<CitizenSurveyResponseRow[]> =>
  repo.listResponses(tenantId, surveyId, limit, offset);
export async function surveyResponseCount(tenantId: string, surveyId: string): Promise<number> {
  return (await repo.countResponsesBySurvey(tenantId, [surveyId])).get(surveyId) ?? 0;
}
