/**
 * Owner decision #4 (2026-10-26, GAP-REVENUE-RECOVERY-01): a coercive recovery
 * referral is allowed only after a demand notice has been SERVED and its notice
 * period has LAPSED. Pure date logic + the tenant-scoped notice lookups.
 *
 * Dates are IST calendar dates (the unit the notice is served in). The notice
 * period is the number of days entered when the notice was served — no
 * statutory default is assumed. The period is over once the IST date is
 * STRICTLY AFTER (servedOn + noticePeriodDays), i.e. the citizen always gets
 * the whole of the last day.
 */
import { and, eq, asc } from "drizzle-orm";
import { demandNotices } from "./schema.js";
import { DomainError } from "../rate-engine/domain.js";

export type NoticeView = {
  id: string;
  noticeNo: string;
  servedOn: string;
  noticePeriodDays: number;
  /** Last day of the notice period (YYYY-MM-DD). */
  lapsesOn: string;
  lapsed: boolean;
};

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** Today's IST calendar date as YYYY-MM-DD. */
export function istToday(now: Date = new Date()): string {
  return new Date(now.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** servedOn + days, as YYYY-MM-DD (pure UTC calendar arithmetic). */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function toNoticeView(
  row: { id: string; noticeNo: string; servedOn: string; noticePeriodDays: number },
  today: string = istToday(),
): NoticeView {
  const lapsesOn = addDays(row.servedOn, row.noticePeriodDays);
  return { id: row.id, noticeNo: row.noticeNo, servedOn: row.servedOn, noticePeriodDays: row.noticePeriodDays, lapsesOn, lapsed: today > lapsesOn };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function listNoticesTx(tx: any, tenantId: string, assesseeId: string): Promise<NoticeView[]> {
  const rows = await tx
    .select({ id: demandNotices.id, noticeNo: demandNotices.noticeNo, servedOn: demandNotices.servedOn, noticePeriodDays: demandNotices.noticePeriodDays })
    .from(demandNotices)
    .where(and(eq(demandNotices.tenantId, tenantId), eq(demandNotices.assesseeId, assesseeId)))
    .orderBy(asc(demandNotices.servedOn));
  const today = istToday();
  return (rows as Array<{ id: string; noticeNo: string; servedOn: string; noticePeriodDays: number }>).map((r) => toNoticeView(r, today));
}

/**
 * The notice a referral may rely on: a served notice whose period has lapsed
 * (the earliest such). Throws NO_NOTICE_SERVED / NOTICE_PERIOD_NOT_LAPSED —
 * fail closed — when there is none.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function requireLapsedNoticeTx(tx: any, tenantId: string, assesseeId: string): Promise<NoticeView> {
  const notices = await listNoticesTx(tx, tenantId, assesseeId);
  if (notices.length === 0) {
    throw new DomainError("NO_NOTICE_SERVED", "Recovery referral requires a demand notice to have been served on this assessee");
  }
  const lapsed = notices.find((n) => n.lapsed);
  if (!lapsed) {
    const next = notices.map((n) => n.lapsesOn).sort()[0]!;
    throw new DomainError("NOTICE_PERIOD_NOT_LAPSED", `The demand notice period has not lapsed yet (it runs to ${next})`);
  }
  return lapsed;
}
