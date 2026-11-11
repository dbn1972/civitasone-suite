/**
 * Meetings -> cross-module search. Indexed: title, meeting number, status, type and date. NOT indexed: agenda, minutes,
 * attendees, venue, VC link, description or decisions.
 *
 * Confidentiality: the meeting read routes are open to every meeting role in the tenant, but a title can itself be
 * sensitive, so only `public` and `internal` meetings are indexed. A meeting that is (or becomes) confidential, secret or
 * top secret, or that is archived test data, is published as a REMOVAL. Flag off for the tenant => returns before any query.
 */
import { and, asc, eq, gt } from "drizzle-orm";
import { syncGlobalRecord, type BackfillEntity, type DrizzleTx, type SearchableFields } from "@civitasone/search";
import { meetings } from "../modules/meeting-core/schema.js";
import type { db } from "./db.js";

type Reader = Pick<typeof db, "select">;
const INDEXABLE_LEVELS = new Set(["public", "internal"]);

const cols = {
  id: meetings.id, tenantId: meetings.tenantId, updatedBy: meetings.updatedBy, title: meetings.title, meetingNumber: meetings.meetingNumber,
  status: meetings.status, type: meetings.type, scheduledAt: meetings.scheduledAt, confidentialityLevel: meetings.confidentialityLevel,
  testDataArchivedAt: meetings.testDataArchivedAt,
};
type Row = { title: string; meetingNumber: string | null; status: string; type: string; scheduledAt: Date | null; confidentialityLevel: string; testDataArchivedAt: Date | null };
export const meetingFields = (r: Row): SearchableFields | null =>
  !INDEXABLE_LEVELS.has(r.confidentialityLevel) || r.testDataArchivedAt
    ? null
    : { title: r.title, refNumber: r.meetingNumber ?? undefined, status: r.status, summary: `${r.type}${r.scheduledAt ? ` · ${r.scheduledAt.toISOString().slice(0, 10)}` : ""}` };

export async function syncMeeting(tx: Reader, id: string, tenantId?: string): Promise<void> {
  await syncGlobalRecord({
    tx: tx as unknown as DrizzleTx, entityType: "meeting.meeting", entityId: id, tenantId,
    load: async () => (await tx.select(cols).from(meetings)
      .where(tenantId ? and(eq(meetings.id, id), eq(meetings.tenantId, tenantId)) : eq(meetings.id, id)).limit(1))[0],
    toRecord: meetingFields,
  });
}

export function backfillEntities(tenantId: string, withTenant: <T>(fn: (tx: Reader) => Promise<T>) => Promise<T>): BackfillEntity[] {
  return [{
    entityType: "meeting.meeting",
    source: {
      tenantId, idOf: (r: { id: string }) => r.id,
      fetchPage: (after: string | null, size: number) => withTenant((tx) => tx.select(cols).from(meetings)
        .where(and(eq(meetings.tenantId, tenantId), after ? gt(meetings.id, after) : undefined)).orderBy(asc(meetings.id)).limit(size)),
      toRecord: (r: Row & { id: string }) => { const f = meetingFields(r); return f ? { ...f, entityType: "meeting.meeting" as const, entityId: r.id, tenantId } : null; },
    },
  }];
}
