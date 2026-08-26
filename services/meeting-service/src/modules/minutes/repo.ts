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
import { and, asc, eq, inArray } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { minutes, minutesVersions, type MinutesRow, type MinutesVersionRow } from "./schema.js";
import { meetings } from "../meeting-core/schema.js";
import { decisions } from "../decision/schema.js";
import { computeHash, verifyChain, isDecisionAmendedAfterApproval, type ChainRecord } from "./domain.js";

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
    const rows = await scopedRead((tx) => tx
      .select()
      .from(minutes)
      .where(and(eq(minutes.id, minutesId), eq(minutes.tenantId, tenantId)))
      .limit(1));
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
  const idRows = await scopedRead((tx) => tx
    .select({ id: minutes.id })
    .from(minutes)
    .where(and(eq(minutes.meetingId, meetingId), eq(minutes.tenantId, tenantId)))
    .limit(1));
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
      scopedRead((tx) => tx
        .select()
        .from(minutesVersions)
        .where(and(eq(minutesVersions.minutesId, minutesId), eq(minutesVersions.tenantId, tenantId)))
        .orderBy(asc(minutesVersions.versionNum))),
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
  const rows = await scopedRead((tx) => tx
    .select()
    .from(minutesVersions)
    .where(
      and(
        eq(minutesVersions.minutesId, minutesId),
        eq(minutesVersions.tenantId, tenantId),
        eq(minutesVersions.versionNum, versionNum),
      ),
    )
    .limit(1));
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
  const rows = await scopedRead((tx) => tx
    .select({ id: meetings.id, status: meetings.status })
    .from(meetings)
    .where(and(eq(meetings.id, meetingId), eq(meetings.tenantId, tenantId)))
    .limit(1));
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

/**
 * Load the committee's full approved+ minutes hash chain (P23), oldest → newest, as the
 * `ChainRecord`s `verifyChain` consumes. Mirrors the ordering `minutes/consumer.ts`'s
 * `previousChainHash` relies on when linking a new approval — the same committee-scoped,
 * approved/signed/circulated-only, tenant-scoped query, just unbounded instead of `LIMIT 1`.
 */
async function loadCommitteeChain(tenantId: string, committeeId: string): Promise<ChainRecord[]> {
  return scopedRead((tx) => tx
    .select({ content: minutes.content, hashPrevious: minutes.hashPrevious, hashCurrent: minutes.hashCurrent })
    .from(minutes)
    .innerJoin(meetings, and(eq(meetings.id, minutes.meetingId), eq(meetings.tenantId, minutes.tenantId)))
    .where(
      and(
        eq(minutes.tenantId, tenantId),
        eq(meetings.committeeId, committeeId),
        inArray(minutes.status, ["approved", "signed", "circulated"]),
      ),
    )
    .orderBy(asc(minutes.approvedAt)));
}

/**
 * Classify a located minutes row's integrity (P24 + P23) into the public result shape.
 *
 * A signed document is "valid" only when BOTH hold:
 *   - P24: its own `hash_current` equals `SHA256(content)` (self-consistency).
 *   - P23: the committee's FULL hash chain it belongs to verifies end-to-end (`verifyChain`) —
 *     not merely this one row in isolation. Self-consistency alone is not tamper-evident: a
 *     direct DB edit that rewrites `content` and also recomputes `hash_current` to match would
 *     pass a self-only check, because it leaves THIS row internally consistent — the tampering
 *     only shows up as a broken link on the NEXT record in the chain, whose `hash_previous` still
 *     points at this row's pre-tamper hash. Walking the whole committee chain catches that break
 *     regardless of which record in the chain happens to be the one a caller is verifying.
 *   - A meeting with no committee has no cross-meeting chain (each such minutes is its own
 *     genesis); P24 self-consistency is the full check in that case.
 *
 * Unsigned records are reported as such rather than "valid" (nothing has been sealed yet) — the
 * chain walk only runs for a signed document, same gate as before.
 */
async function classifyIntegrity(tenantId: string, row: MinutesRow): Promise<MinutesVerificationResult> {
  const signed = Boolean(row.dscSignature);
  const base = {
    found: true as const,
    signed,
    minutesId: row.id,
    meetingId: row.meetingId,
    status: row.status,
    signerName: row.dscSignerName,
    signedAt: row.dscSignedAt ? row.dscSignedAt.toISOString() : null,
    hashCurrent: row.hashCurrent,
  };
  if (!signed) return { ...base, integrity: "unsigned" };

  // P24 self-consistency first (cheap, no query) — only walk the chain when it holds, since a
  // self-hash mismatch is already conclusive "tampered" on its own.
  let valid = row.hashCurrent !== null && row.hashCurrent === computeHash(row.content);
  if (valid) {
    const meetingRows = await scopedRead((tx) => tx
      .select({ committeeId: meetings.committeeId })
      .from(meetings)
      .where(and(eq(meetings.id, row.meetingId), eq(meetings.tenantId, tenantId)))
      .limit(1));
    const committeeId = meetingRows[0]?.committeeId ?? null;
    if (committeeId) {
      // P23: the FULL committee chain, not just this row — see the doc comment above.
      const chain = await loadCommitteeChain(tenantId, committeeId);
      valid = verifyChain(chain).valid;
    }
  }
  const integrity: MinutesIntegrity = valid ? "valid" : "tampered";
  return { ...base, integrity };
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
      rows = await scopedRead((tx) => tx
        .select()
        .from(minutes)
        .where(and(eq(minutes.id, lookup.minutesId!), eq(minutes.tenantId, tenantId)))
        .limit(1));
    } else if (lookup.hashCurrent) {
      rows = await scopedRead((tx) => tx
        .select()
        .from(minutes)
        .where(and(eq(minutes.hashCurrent, lookup.hashCurrent!), eq(minutes.tenantId, tenantId)))
        .limit(1));
    }
    const row = rows[0];
    return row ? await classifyIntegrity(tenantId, row) : null;
  };

  // No tenant / no lookup key → cannot resolve; report not_found without touching the DB.
  if (!tenantId || (!lookup.minutesId && !lookup.hashCurrent)) return notFound;

  const key = lookup.minutesId
    ? cache.makeKey(tenantId, RESOURCE_MINUTES_VERIFY, lookup.minutesId)
    : cache.makeKey(tenantId, RESOURCE_MINUTES_VERIFY_HASH, lookup.hashCurrent as string);

  const result = await cache.getOrLoad<MinutesVerificationResult>(key, load);
  return result ?? notFound;
}

// ─── Decision drift detection (Req 7.5 spirit, cross-module read-only) ───────

/** A decision that appears to have drifted from the minutes that recorded it. */
export interface DecisionDrift {
  decisionId: string;
  updatedAt: string;
}

/**
 * Detect decisions belonging to an approved+ minutes' meeting that were updated AFTER the
 * minutes were approved (Req 7.5 spirit; see domain.ts `isDecisionAmendedAfterApproval`).
 *
 * PARTIAL MITIGATION, NOT PREVENTION. `minutes/consumer.ts`'s `assertMinutesEditable` correctly
 * locks the minutes' OWN content once approved — but nothing today stops the underlying
 * `meeting.decisions` row(s) it recorded from being amended afterward, because
 * `decision/consumer.ts`'s `handleDecisionUpdate` never queries `minutes` before writing a patch.
 * This function only makes that drift DETECTABLE from the minutes side (read-only cross-module
 * query, the same established pattern this module already uses for resolutions/committees/
 * participants) — it does not and cannot prevent the amendment. A caller wires it into a read
 * path (e.g. the minutes GET route, or alongside `verifySignature`) when it wants to surface the
 * drift to a user.
 *
 * Closing this for real needs ONE guard in decision/consumer.ts's `handleDecisionUpdate` (around
 * where it currently does `select({ id: decisions.id })` as a bare existence check): also select
 * `meetingId`, look up that meeting's minutes status (mirroring `minutes/repo.ts`'s
 * `getMinutesByMeeting`), and reject the patch (like `minutes/consumer.ts`'s
 * `handleMinutesUpdate` already does via `assertMinutesEditable`) when `isMinutesLocked(status)`
 * is true — both `isMinutesLocked` and the minutes query pattern already exist and are exported
 * for exactly this reuse. Not made here: decision/** is a sibling module's ownership.
 */
export async function getDecisionDrift(tenantId: string, minutesRow: MinutesRow): Promise<DecisionDrift[]> {
  if (!minutesRow.approvedAt) return [];
  const rows = await scopedRead((tx) => tx
    .select({ id: decisions.id, updatedAt: decisions.updatedAt })
    .from(decisions)
    .where(and(eq(decisions.tenantId, tenantId), eq(decisions.meetingId, minutesRow.meetingId))));
  return rows
    .filter((d) => isDecisionAmendedAfterApproval(d.updatedAt, minutesRow.approvedAt))
    .map((d) => ({ decisionId: d.id, updatedAt: d.updatedAt.toISOString() }));
}
