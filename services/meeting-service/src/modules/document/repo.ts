/**
 * document module — cache-first read model (CQRS read side).
 *
 * READ-ONLY: every write goes through the command publishers in commands.ts → consumer →
 * transactional outbox. Single-document + version-history lookups use the Redis
 * read-through cache (`cache.getOrLoad`, steering: "All reads through Redis cache"); the
 * per-meeting list query hits Postgres directly (RLS-scoped by tenant_id via the
 * per-request tenant-tx hook) and always carries an explicit `tenant_id` predicate as
 * defence-in-depth.
 *
 * Classification-based access control (Req 15.5, 19.3, 19.7) is applied at the ROUTE using
 * the pure helpers in validators.ts; the list read here additionally filters rows down to
 * the caller's clearance (`maxRank`) so an unauthorized row is never even returned. The
 * parent meeting is OWNED by meeting-core; the lightweight existence guard reads it
 * directly (uncached) so it never clobbers meeting-core's own meeting cache.
 *
 * Cache keys owned here:
 *   • `meeting:{tenant}:document:{documentId}`          → single live document (getDocument)
 *   • `meeting:{tenant}:document_versions:{documentId}` → version lineage (getVersionHistory)
 *
 * _Requirements: 4.1, 15.1, 15.2, 15.4, 15.5, 19.3, 19.7_
 */
import { and, desc, eq, isNull, lte } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { cache, storage } from "../../shared/infra.js";
import { meetings } from "../meeting-core/schema.js";
import { meetingDocuments, type MeetingDocumentRow } from "./schema.js";
import { rankOf } from "./validators.js";

const RESOURCE_DOCUMENT = "document";
const RESOURCE_DOCUMENT_VERSIONS = "document_versions";
/** Documents are fairly static once uploaded — cache single lookups for 5 minutes. */
const DOCUMENT_TTL = 300;
/** Version lineage can grow when a replacement is uploaded — shorter TTL. */
const VERSIONS_TTL = 60;

// ─── Meeting existence guard (owned by meeting-core; read directly) ──────────────

export interface MeetingStatus {
  id: string;
  status: string;
}

/** Direct (uncached) meeting existence + status lookup, tenant-scoped (route 404 guard). */
export async function getMeetingStatus(tenantId: string, meetingId: string): Promise<MeetingStatus | null> {
  const rows = await db
    .select({ id: meetings.id, status: meetings.status })
    .from(meetings)
    .where(and(eq(meetings.id, meetingId), eq(meetings.tenantId, tenantId)))
    .limit(1);
  return rows[0] ?? null;
}

// ─── Single document ─────────────────────────────────────────────────────────

/**
 * Fetch a single LIVE (not soft-deleted) document by id, cache-first. Returns null when
 * the document does not exist, was removed, or belongs to another tenant — the route uses
 * this to 404. Classification access is enforced by the route (an unauthorized Secret/
 * Top_Secret read is answered with a 404, never leaking existence — Req 19.7).
 */
export async function getDocument(tenantId: string, documentId: string): Promise<MeetingDocumentRow | null> {
  return cache.getOrLoad<MeetingDocumentRow>(
    cache.makeKey(tenantId, RESOURCE_DOCUMENT, documentId),
    async () => {
      const rows = await db
        .select()
        .from(meetingDocuments)
        .where(
          and(
            eq(meetingDocuments.id, documentId),
            eq(meetingDocuments.tenantId, tenantId),
            isNull(meetingDocuments.deletedAt),
          ),
        )
        .limit(1);
      return rows[0] ?? null;
    },
    DOCUMENT_TTL,
  );
}

// ─── Document list (per meeting) ─────────────────────────────────────────────

export interface ListDocumentsFilter {
  agendaItemId?: string | undefined;
  documentType?: string | undefined;
  /** Caller's maximum classification clearance rank (validators.maxClearanceRank). */
  maxRank: number;
}

/**
 * List LIVE documents for a meeting, filtered to the caller's clearance (Req 15.5) and by
 * optional agenda item / document type. Rows above the caller's clearance are excluded
 * entirely (never returned), so observers see only non-confidential documents and special
 * invitees see only what they are cleared for. Newest first.
 */
export async function getDocuments(
  tenantId: string,
  meetingId: string,
  filter: ListDocumentsFilter,
): Promise<MeetingDocumentRow[]> {
  const conditions = [
    eq(meetingDocuments.tenantId, tenantId),
    eq(meetingDocuments.meetingId, meetingId),
    isNull(meetingDocuments.deletedAt),
  ];
  if (filter.agendaItemId !== undefined) conditions.push(eq(meetingDocuments.agendaItemId, filter.agendaItemId));
  if (filter.documentType !== undefined) conditions.push(eq(meetingDocuments.documentType, filter.documentType));

  const rows = await db
    .select()
    .from(meetingDocuments)
    .where(and(...conditions))
    .orderBy(desc(meetingDocuments.createdAt));

  // Defence-in-depth clearance filter (SQL rank comparison would require a CASE; a small
  // in-memory filter over an already tenant/meeting-scoped set is clearer and safe).
  return rows.filter((r) => rankOf(r.classification) <= filter.maxRank);
}

// ─── Version history (Req 15.4) ──────────────────────────────────────────────

/**
 * Return the version lineage a document belongs to (Req 15.4), ordered oldest → newest by
 * `version_num`. The lineage is reconstructed from the `previous_version_id` links: we walk
 * ancestors backwards from the given document, then walk descendants forwards. Cache-first
 * on `document_versions:{documentId}`; returns [] when the document is unknown / another
 * tenant's. Soft-deleted rows are excluded.
 */
export async function getVersionHistory(tenantId: string, documentId: string): Promise<MeetingDocumentRow[]> {
  const rows = await cache.getOrLoad<MeetingDocumentRow[]>(
    cache.makeKey(tenantId, RESOURCE_DOCUMENT_VERSIONS, documentId),
    async () => {
      const target = await loadById(tenantId, documentId);
      if (!target) return null;

      const chain: MeetingDocumentRow[] = [target];

      // Ancestors: follow previous_version_id backwards.
      let cursor: MeetingDocumentRow | null = target;
      const seen = new Set<string>([target.id]);
      while (cursor?.previousVersionId && !seen.has(cursor.previousVersionId)) {
        const prev: MeetingDocumentRow | null = await loadById(tenantId, cursor.previousVersionId);
        if (!prev) break;
        seen.add(prev.id);
        chain.unshift(prev);
        cursor = prev;
      }

      // Descendants: find the row whose previous_version_id points at the current head.
      let headId = target.id;
      while (true) {
        const next = await loadByPreviousVersionId(tenantId, headId);
        if (!next || seen.has(next.id)) break;
        seen.add(next.id);
        chain.push(next);
        headId = next.id;
      }

      chain.sort((a, b) => a.versionNum - b.versionNum);
      return chain;
    },
    VERSIONS_TTL,
  );
  return rows ?? [];
}

/** Load a single LIVE document by id (used by the version-lineage walk). */
async function loadById(tenantId: string, id: string): Promise<MeetingDocumentRow | null> {
  const rows = await db
    .select()
    .from(meetingDocuments)
    .where(and(eq(meetingDocuments.id, id), eq(meetingDocuments.tenantId, tenantId), isNull(meetingDocuments.deletedAt)))
    .limit(1);
  return rows[0] ?? null;
}

/** Load the LIVE document that supersedes `previousVersionId` (its immediate successor). */
async function loadByPreviousVersionId(tenantId: string, previousVersionId: string): Promise<MeetingDocumentRow | null> {
  const rows = await db
    .select()
    .from(meetingDocuments)
    .where(
      and(
        eq(meetingDocuments.previousVersionId, previousVersionId),
        eq(meetingDocuments.tenantId, tenantId),
        isNull(meetingDocuments.deletedAt),
      ),
    )
    .orderBy(desc(meetingDocuments.versionNum))
    .limit(1);
  return rows[0] ?? null;
}

// ─── Download URL (Req 15.2) ─────────────────────────────────────────────────

/**
 * Mint a short-lived presigned GET URL for a document's stored object. The route enforces
 * classification access + the Top_Secret view-only rule (Req 19.4) BEFORE calling this, so
 * this only ever runs for an authorized, downloadable document.
 */
export async function getDownloadUrl(storageKey: string, expiresIn = 300): Promise<string> {
  return storage.presignedGetUrl({ key: storageKey, expiresIn });
}

// Re-export the rank comparison used by lists so callers do not import validators twice.
export { rankOf } from "./validators.js";
