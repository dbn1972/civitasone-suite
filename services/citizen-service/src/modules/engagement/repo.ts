import { eq, and, inArray, sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import {
  citizenAlerts, citizenNotices, citizenSurveys, citizenSurveyResponses,
  type CitizenAlertRow, type CitizenAlertInsert, type CitizenNoticeRow, type CitizenNoticeInsert,
  type CitizenSurveyRow, type CitizenSurveyInsert, type CitizenSurveyResponseRow, type CitizenSurveyResponseInsert,
} from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

// Every read below is wrapped in db.transaction() so wrapWithTenantGuc injects
// app.tenant_id before the query (FORCE RLS); every predicate ALSO carries an
// explicit tenant_id so isolation does not rest on RLS alone.

// ── alerts ───────────────────────────────────────────────────────────────
export async function insertAlert(tx: Writer, row: CitizenAlertInsert): Promise<void> {
  await tx.insert(citizenAlerts).values(row).onConflictDoNothing();
}
export async function findAlert(tenantId: string, id: string): Promise<CitizenAlertRow | null> {
  const rows = await db.transaction((tx) => tx.select().from(citizenAlerts)
    .where(and(eq(citizenAlerts.id, id), eq(citizenAlerts.tenantId, tenantId))).limit(1));
  return rows[0] ?? null;
}
export async function listAlerts(tenantId: string, statuses: string[] | null, limit: number, offset: number): Promise<CitizenAlertRow[]> {
  const conds = [eq(citizenAlerts.tenantId, tenantId)];
  if (statuses) conds.push(inArray(citizenAlerts.status, statuses));
  return db.transaction((tx) => tx.select().from(citizenAlerts).where(and(...conds))
    .orderBy(sql`${citizenAlerts.publishedAt} DESC NULLS LAST, ${citizenAlerts.createdAt} DESC`)
    .limit(limit).offset(offset));
}
/** Guarded transition: only rows currently in `from` are touched. Returns rows changed. */
export async function transitionAlert(
  tx: Writer, tenantId: string, id: string, from: string[], patch: Partial<CitizenAlertInsert>,
): Promise<number> {
  const rows = await (tx as typeof db).update(citizenAlerts)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(citizenAlerts.id, id), eq(citizenAlerts.tenantId, tenantId), inArray(citizenAlerts.status, from)))
    .returning({ id: citizenAlerts.id });
  return rows.length;
}

// ── notices ──────────────────────────────────────────────────────────────
export async function insertNotice(tx: Writer, row: CitizenNoticeInsert): Promise<void> {
  await tx.insert(citizenNotices).values(row).onConflictDoNothing();
}
export async function findNotice(tenantId: string, id: string): Promise<CitizenNoticeRow | null> {
  const rows = await db.transaction((tx) => tx.select().from(citizenNotices)
    .where(and(eq(citizenNotices.id, id), eq(citizenNotices.tenantId, tenantId))).limit(1));
  return rows[0] ?? null;
}
export async function findNoticeByNo(tenantId: string, noticeNo: string): Promise<CitizenNoticeRow | null> {
  const rows = await db.transaction((tx) => tx.select().from(citizenNotices)
    .where(and(eq(citizenNotices.noticeNo, noticeNo), eq(citizenNotices.tenantId, tenantId))).limit(1));
  return rows[0] ?? null;
}
export async function listNotices(tenantId: string, statuses: string[] | null, limit: number, offset: number): Promise<CitizenNoticeRow[]> {
  const conds = [eq(citizenNotices.tenantId, tenantId)];
  if (statuses) conds.push(inArray(citizenNotices.status, statuses));
  return db.transaction((tx) => tx.select().from(citizenNotices).where(and(...conds))
    .orderBy(sql`${citizenNotices.publishedAt} DESC NULLS LAST, ${citizenNotices.createdAt} DESC`)
    .limit(limit).offset(offset));
}
export async function transitionNotice(
  tx: Writer, tenantId: string, id: string, from: string[], patch: Partial<CitizenNoticeInsert>,
): Promise<number> {
  const rows = await (tx as typeof db).update(citizenNotices)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(citizenNotices.id, id), eq(citizenNotices.tenantId, tenantId), inArray(citizenNotices.status, from)))
    .returning({ id: citizenNotices.id });
  return rows.length;
}

// ── surveys ──────────────────────────────────────────────────────────────
export async function insertSurvey(tx: Writer, row: CitizenSurveyInsert): Promise<void> {
  await tx.insert(citizenSurveys).values(row).onConflictDoNothing();
}
export async function findSurvey(tenantId: string, id: string): Promise<CitizenSurveyRow | null> {
  const rows = await db.transaction((tx) => tx.select().from(citizenSurveys)
    .where(and(eq(citizenSurveys.id, id), eq(citizenSurveys.tenantId, tenantId))).limit(1));
  return rows[0] ?? null;
}
export async function findSurveyTx(tx: Writer, tenantId: string, id: string): Promise<CitizenSurveyRow | null> {
  const rows = await (tx as typeof db).select().from(citizenSurveys)
    .where(and(eq(citizenSurveys.id, id), eq(citizenSurveys.tenantId, tenantId))).limit(1);
  return rows[0] ?? null;
}
export async function listSurveys(tenantId: string, statuses: string[] | null, limit: number, offset: number): Promise<CitizenSurveyRow[]> {
  const conds = [eq(citizenSurveys.tenantId, tenantId)];
  if (statuses) conds.push(inArray(citizenSurveys.status, statuses));
  return db.transaction((tx) => tx.select().from(citizenSurveys).where(and(...conds))
    .orderBy(sql`${citizenSurveys.createdAt} DESC`).limit(limit).offset(offset));
}
export async function transitionSurvey(
  tx: Writer, tenantId: string, id: string, from: string[], patch: Partial<CitizenSurveyInsert>,
): Promise<number> {
  const rows = await (tx as typeof db).update(citizenSurveys)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(citizenSurveys.id, id), eq(citizenSurveys.tenantId, tenantId), inArray(citizenSurveys.status, from)))
    .returning({ id: citizenSurveys.id });
  return rows.length;
}

// ── survey responses (owner-scoped) ──────────────────────────────────────
export async function insertResponse(tx: Writer, row: CitizenSurveyResponseInsert): Promise<boolean> {
  const rows = await tx.insert(citizenSurveyResponses).values(row).onConflictDoNothing()
    .returning({ id: citizenSurveyResponses.id });
  return rows.length > 0;
}
/** Owner-scoped: a response is only ever fetched by (survey, citizen) — never by id alone. */
export async function findOwnResponse(tenantId: string, surveyId: string, citizenId: string): Promise<CitizenSurveyResponseRow | null> {
  const rows = await db.transaction((tx) => tx.select().from(citizenSurveyResponses)
    .where(and(
      eq(citizenSurveyResponses.tenantId, tenantId),
      eq(citizenSurveyResponses.surveyId, surveyId),
      eq(citizenSurveyResponses.citizenId, citizenId),
    )).limit(1));
  return rows[0] ?? null;
}
export async function listResponses(tenantId: string, surveyId: string, limit: number, offset: number): Promise<CitizenSurveyResponseRow[]> {
  return db.transaction((tx) => tx.select().from(citizenSurveyResponses)
    .where(and(eq(citizenSurveyResponses.tenantId, tenantId), eq(citizenSurveyResponses.surveyId, surveyId)))
    .orderBy(sql`${citizenSurveyResponses.submittedAt} DESC`).limit(limit).offset(offset));
}
export async function countResponsesBySurvey(tenantId: string, surveyIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (surveyIds.length === 0) return out;
  const rows = await db.transaction((tx) => tx
    .select({ surveyId: citizenSurveyResponses.surveyId, n: sql<number>`count(*)::int` })
    .from(citizenSurveyResponses)
    .where(and(eq(citizenSurveyResponses.tenantId, tenantId), inArray(citizenSurveyResponses.surveyId, surveyIds)))
    .groupBy(citizenSurveyResponses.surveyId));
  for (const r of rows) out.set(r.surveyId, r.n);
  return out;
}
