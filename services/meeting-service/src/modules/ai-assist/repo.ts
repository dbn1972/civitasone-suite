/**
 * AI-assist module — cache-first DB reads (CQRS read side).
 *
 * Read-only. The mutating AI flows go through commands.ts (route → queue → consumer); this file
 * serves the GET transcript endpoint and the small context reads the synchronous suggest-agenda
 * endpoint needs, following the suite rule "all reads through Redis cache" (`cache.getOrLoad`
 * with a bounded TTL backstop). Every query is tenant-scoped for RLS-compatible isolation.
 *
 * The parent meeting is OWNED by meeting-core; the lightweight existence/status guard
 * (`getMeetingStatus`) reads it directly (uncached) so this module never clobbers meeting-core's
 * own meeting cache.
 *
 * _Requirements: 17.1, 17.4_
 */
import { and, desc, eq, ne } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { cache, storage } from "../../shared/infra.js";
import { meetingDocuments, AI_DOC_TYPE_TRANSCRIPT } from "./schema.js";
import { meetings } from "../meeting-core/schema.js";
import { agendaItems } from "../agenda/schema.js";

const RESOURCE_TRANSCRIPT = "ai_transcript";

/** Live existence/status of the parent meeting for the route guards (uncached). */
export interface MeetingStatus {
  id: string;
  status: string;
  committeeId: string | null;
}

/** Direct (uncached) meeting existence + status lookup, tenant-scoped. */
export async function getMeetingStatus(tenantId: string, meetingId: string): Promise<MeetingStatus | null> {
  const rows = await scopedRead((tx) => tx
    .select({ id: meetings.id, status: meetings.status, committeeId: meetings.committeeId })
    .from(meetings)
    .where(and(eq(meetings.id, meetingId), eq(meetings.tenantId, tenantId)))
    .limit(1));
  return rows[0] ?? null;
}

/** The transcript view returned by GET .../ai/transcript. */
export interface TranscriptView {
  documentId: string;
  meetingId: string;
  storageKey: string;
  hash: string;
  /**
   * Confidentiality classification inherited from the meeting (Req 19.1, 19.3). Gates the read
   * at the route via `canAccessClassification`, reused from the document module — the SAME
   * check document/routes.ts applies to every other read of this shared `meeting_documents`
   * table (audit finding: this module used to skip it entirely).
   */
  classification: string;
  fileName: string;
  createdAt: string;
  /** Transcript text, fetched best-effort from object storage (null if unavailable). */
  text: string | null;
}

/**
 * Fetch the stored transcript for a meeting (Req 17.x). Cache-first on `ai_transcript:{meetingId}`
 * for the metadata; the transcript text is loaded best-effort from object storage (a storage
 * miss yields `text: null` rather than an error). Returns null when the meeting has no transcript
 * yet / belongs to another tenant.
 */
export async function getTranscript(tenantId: string, meetingId: string): Promise<TranscriptView | null> {
  const meta = await cache.getOrLoad<Omit<TranscriptView, "text"> | null>(
    cache.makeKey(tenantId, RESOURCE_TRANSCRIPT, meetingId),
    async () => {
      const rows = await scopedRead((tx) => tx
        .select({
          documentId: meetingDocuments.id,
          meetingId: meetingDocuments.meetingId,
          storageKey: meetingDocuments.storageKey,
          hash: meetingDocuments.hash,
          classification: meetingDocuments.classification,
          fileName: meetingDocuments.fileName,
          createdAt: meetingDocuments.createdAt,
        })
        .from(meetingDocuments)
        .where(
          and(
            eq(meetingDocuments.meetingId, meetingId),
            eq(meetingDocuments.tenantId, tenantId),
            eq(meetingDocuments.documentType, AI_DOC_TYPE_TRANSCRIPT),
          ),
        )
        .orderBy(desc(meetingDocuments.createdAt))
        .limit(1));
      const row = rows[0];
      if (!row) return null;
      return {
        documentId: row.documentId,
        meetingId: row.meetingId,
        storageKey: row.storageKey,
        hash: row.hash,
        classification: row.classification,
        fileName: row.fileName,
        createdAt: row.createdAt.toISOString(),
      };
    },
  );
  if (!meta) return null;

  let text: string | null = null;
  try {
    const buf = await storage.getObject(meta.storageKey);
    text = buf.toString("utf8");
  } catch {
    // Graceful degradation: metadata is authoritative; the body can be re-fetched on demand.
    text = null;
  }
  return { ...meta, text };
}

/**
 * Titles of agenda items from PREVIOUS meetings of the same committee (Req 17.x context for
 * suggest-agenda). Excludes withdrawn items and the current meeting. Read directly (uncached):
 * this feeds a synchronous, best-effort suggestion and does not need its own cache entry.
 * Returns a de-duplicated, bounded list (most recent first).
 */
export async function getPreviousAgendaTitles(
  tenantId: string,
  committeeId: string,
  excludeMeetingId: string,
  limit = 20,
): Promise<string[]> {
  const rows = await scopedRead((tx) => tx
    .select({ title: agendaItems.title, createdAt: agendaItems.createdAt })
    .from(agendaItems)
    .innerJoin(meetings, and(eq(meetings.id, agendaItems.meetingId), eq(meetings.tenantId, agendaItems.tenantId)))
    .where(
      and(
        eq(agendaItems.tenantId, tenantId),
        eq(meetings.committeeId, committeeId),
        ne(agendaItems.meetingId, excludeMeetingId),
        ne(agendaItems.status, "withdrawn"),
      ),
    )
    .orderBy(desc(agendaItems.createdAt))
    .limit(100));

  const seen = new Set<string>();
  const titles: string[] = [];
  for (const r of rows) {
    if (seen.has(r.title)) continue;
    seen.add(r.title);
    titles.push(r.title);
    if (titles.length >= limit) break;
  }
  return titles;
}
