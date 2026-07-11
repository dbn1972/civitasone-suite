/**
 * Minutes module — cache-first DB reads (CQRS read side).
 *
 * Read-only: every write goes through the command publishers in commands.ts
 * (route → zod → queue.publish → 202) and is applied by consumer.ts. Reads follow the
 * suite rule "all reads through Redis cache" — the primary minutes resource is served via
 * `cache.getOrLoad` on the canonical `minutes:{id}` key, the exact key the command
 * publishers and consumer invalidate after every minutes write commits. A bounded TTL is
 * the self-healing backstop for any derived key not explicitly invalidated.
 *
 * Cache keys owned here:
 *   - `meeting:{tenant}:minutes:{minutesId}`          → single minutes record (getMinutes)
 *   - `meeting:{tenant}:minutes_versions:{minutesId}` → append-only version history (getVersionHistory)
 *   - `meeting:{tenant}:minutes_verify:{minutesId}`   → public verification result by id (verifySignature)
 *   - `meeting:{tenant}:minutes_verify_hash:{hash}`   → public verification result by content hash
 *
 * The parent meeting is OWNED by meeting-core; the lightweight existence/status guard used by
 * the routes (`getMeetingStatus`) reads it DIRECTLY (uncached) so a caching layer here never
 * clobbers meeting-core's own `meeting:{tenant}:meeting:{id}` cache and the guard always sees
 * the live status. Every query is tenant-scoped for RLS-compatible isolation.
 *
 * The public verification path (Req 8.4) recomputes `SHA256(content)` via the domain
 * `computeHash` and compares it to the persisted `hash_current` (P24) to classify document
 * integrity as valid / tampered — the tamper-evidence surface required by CERT-In (Req 8.5).
 *
 * _Requirements: 7.1, 7.3, 7.5, 7.8, 8.1, 8.4_
 */
import { and, asc, eq } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { minutes, minutesVersions, type MinutesRow, type MinutesVersionRow } from "./schema.js";
import { meetings } from "../meeting-core/schema.js";
import { computeHash } from "./domain.js";

/** Cache resource segments (second-to-last key component). */
const RESOURCE_MINUTES = "minutes";
const RESOURCE_MINUTES_VERSIONS = "minutes_versions";
const RESOURCE_MINUTES_VERIFY = "minutes_verify";
const RESOURCE_MINUTES_VERIFY_HASH = "minutes_verify_hash";

/**
 * Fetch a single minutes record by id (Req 7.1, 7.5). Cache-first on the canonical
 * `minutes:{minutesId}` key — the exact key commands.ts / consumer.ts invalidate after every
 * write. Returns null (and does not cache a hit) when the record does not exist or belongs to
 * another tenant; the PATCH / submit / approve / reject / sign / circulate routes use this to
 * answer 404 before publishing a command.
 */
export async function getMinutes(tenantId: string, minutesId: string): Promise<MinutesRow | null> {
  return cache.getOrLoad<MinutesRow>(cache.makeKey(tenantId, RESOURCE_MINUTES, minutesId), async () => {
    const rows = await db
      .select()
      .from(minutes)
      .where(and(eq(minutes.id, minutesId), eq(minutes.tenantId, tenantId)))
      .limit(1);
    return rows[0] ?? null;
  });
}

/**
 * Fetch the (single) minutes record for a meeting (Req 7.1). Resolves the minutes id for the
 * meeting with a lightweight uncached lookup, then serves the row cache-first through the
 * canonical `minutes:{id}` key so there is a single cached source of truth (avoids a
 * meeting-scoped key the consumer would not invalidate). Returns null when the meeting has no
 * minutes yet / belongs to another tenant.
 */
export async function getMinutesByMeeting(tenantId: string, meetingId: string): Promise<MinutesRow | null> {
  const idRows = await db
    .select({ id: minutes.id })
    .from(minutes)
    .where(and(eq(minutes.meetingId, meetingId), eq(minutes.tenantId, tenantId)))
    .limit(1);
  const id = idRows[0]?.id;
  if (!id) return null;
  return getMinutes(tenantId, id);
}

/**
 * List the append-only version history of a minutes draft, oldest → newest (Req 7.8). Cache-first
 * on `minutes_versions:{minutesId}`; the bounded TTL bounds staleness after a new snapshot is
 * appended (version rows are immutable, so a stale hit only ever omits the newest entry). Returns
 * [] when there are no versions / the minutes belong to another tenant.
 */
export async function getVersionHistory(tenantId: string, minutesId: string): Promise<MinutesVersionRow[]> {
  const rows = await cache.getOrLoad<MinutesVersionRow[]>(
    cache.makeKey(tenantId, RESOURCE_MINUTES_VERSIONS, minutesId),
    async () =>
      db
        .select()
        .from(minutesVersions)
        .where(and(eq(minutesVersions.minutesId, minutesId), eq(minutesVersions.tenantId, tenantId)))
        .orderBy(asc(minutesVersions.versionNum)),
  );
  return rows ?? [];
}

/**
 * Fetch a single historical version of a minutes draft by version number (Req 7.8). Read
 * directly (uncached): version rows are immutable and this exact-match lookup is rare, so a
 * dedicated cache entry per (minutesId, versionNum) is not worth the invalidation surface.
 * Returns null when the version does not exist / the minutes belong to another tenant.
 */
export async function getVersion(
  tenantId: string,
  minutesId: string,
  versionNum: number,
): Promise<MinutesVersionRow | null> {
  const rows = await db
    .select()
    .from(minutesVersions)
    .where(
      and(
        eq(minutesVersions.minutesId, minutesId),
        eq(minutesVersions.tenantId, tenantId),
        eq(minutesVersions.versionNum, versionNum),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/** Live existence/status of the parent meeting for the route guards (uncached — see file header). */
export interface MeetingStatus {
  id: string;
  status: string;
}

/**
 * Direct (uncached) meeting existence + status lookup, tenant-scoped. Used by the minutes routes
 * to return 404 when the meeting is unknown. Owned by meeting-core; read here only as a boundary
 * guard.
 */
export async function getMeetingStatus(tenantId: string, meetingId: string): Promise<MeetingStatus | null> {
  const rows = await db
    .select({ id: meetings.id, status: meetings.status })
    .from(meetings)
    .where(and(eq(meetings.id, meetingId), eq(meetings.tenantId, tenantId)))
    .limit(1);
  return rows[0] ?? null;
}

// ─── Public verification (Req 8.4 · P24) ─────────────────────────────────────

/** Integrity classification returned by the public verification endpoint. */
export type MinutesIntegrity = "valid" | "tampered" | "unsigned" | "not_found";

/**
 * Result of the public minutes verification endpoint (Req 8.4). Discloses only what a verifier
 * needs: signer identity, signing timestamp, integrity status, and the meeting reference — never
 * the minutes content itself.
 */
export interface MinutesVerificationResult {
  /** True when a matching minutes record was located in the tenant. */
  found: boolean;
  /** Document integrity: valid (signed + hash matches), tampered (hash mismatch), unsigned, or not_found. */
  integrity: MinutesIntegrity;
  /** True when a DSC signature is present on the record. */
  signed: boolean;
  minutesId?: string;
  /** The meeting this minutes belongs to — the public "meeting reference". */
  meetingId?: string;
  /** Lifecycle status (draft | submitted | approved | signed | circulated). */
  status?: string;
  /** DSC signer identity (chairperson) when signed. */
  signerName?: string | null;
  /** ISO-8601 signing timestamp when signed. */
  signedAt?: string | null;
  /** The persisted content hash (chain head) — echoed for QR cross-checking. */
  hashCurrent?: string | null;
}

/** Lookup key for verification: either the minutes id or the content hash from the QR code. */
export interface MinutesVerifyLookup {
  minutesId?: string;
  hashCurrent?: string;
}

/** Classify a located minutes row's integrity (P24) into the public result shape. */
function classifyIntegrity(row: MinutesRow): MinutesVerificationResult {
  const signed = Boolean(row.dscSignature);
  // P24: a signed document's persisted hash_current MUST equal SHA256(content). Any drift means
  // the stored content was altered after sealing → tampered. Unsigned records are reported as
  // such rather than "valid" (nothing has been sealed yet).
  const hashMatches = row.hashCurrent !== null && row.hashCurrent === computeHash(row.content);
  const integrity: MinutesIntegrity = signed ? (hashMatches ? "valid" : "tampered") : "unsigned";
  return {
    found: true,
    integrity,
    signed,
    minutesId: row.id,
    meetingId: row.meetingId,
    status: row.status,
    signerName: row.dscSignerName,
    signedAt: row.dscSignedAt ? row.dscSignedAt.toISOString() : null,
    hashCurrent: row.hashCurrent,
  };
}

/**
 * Public verification of a signed minutes document (Req 8.4). Accepts either the `minutesId` or
 * the `hashCurrent` scanned from the document QR code and returns the signer identity, signing
 * timestamp, integrity status, and meeting reference. Cache-first on a verification-scoped key
 * (bounded TTL) since the result is derived from an immutable-once-signed record. Returns a
 * `not_found` result (never throws) when no record matches — the endpoint must not leak whether
 * a given id/hash exists beyond this flag.
 */
export async function verifySignature(
  tenantId: string,
  lookup: MinutesVerifyLookup,
): Promise<MinutesVerificationResult> {
  const notFound: MinutesVerificationResult = { found: false, integrity: "not_found", signed: false };

  // Returns null (⇒ not cached) when nothing matches, so a negative result is never memoised
  // ahead of the minutes being created; only a located record is cached (bounded TTL).
  const load = async (): Promise<MinutesVerificationResult | null> => {
    let rows: MinutesRow[] = [];
    if (lookup.minutesId) {
      rows = await db
        .select()
        .from(minutes)
        .where(and(eq(minutes.id, lookup.minutesId), eq(minutes.tenantId, tenantId)))
        .limit(1);
    } else if (lookup.hashCurrent) {
      rows = await db
        .select()
        .from(minutes)
        .where(and(eq(minutes.hashCurrent, lookup.hashCurrent), eq(minutes.tenantId, tenantId)))
        .limit(1);
    }
    const row = rows[0];
    return row ? classifyIntegrity(row) : null;
  };

  // No tenant / no lookup key → cannot resolve; report not_found without touching the DB.
  if (!tenantId || (!lookup.minutesId && !lookup.hashCurrent)) return notFound;

  const key = lookup.minutesId
    ? cache.makeKey(tenantId, RESOURCE_MINUTES_VERIFY, lookup.minutesId)
    : cache.makeKey(tenantId, RESOURCE_MINUTES_VERIFY_HASH, lookup.hashCurrent as string);

  const result = await cache.getOrLoad<MinutesVerificationResult>(key, load);
  return result ?? notFound;
}
