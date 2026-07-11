/**
 * VC-integration — response presenter (secret-stripping boundary).
 *
 * Mirrors the visitor-service `toPublicX` pattern: a pure function that projects an
 * internal VC-session read model into the CLIENT-safe DTO, stripping fields that
 * must never reach an API consumer.
 *
 * The `meeting.vc_sessions` row carries several sensitive/internal columns that the
 * previous `GET /vc/session` handler returned verbatim to every meeting-associated
 * reader (including `committee_member` / `observer`):
 *
 *   - externalId          — the provider-side session identifier used by all
 *                           subsequent adapter calls (getJoinLink, start/stop
 *                           recording, endSession). It is an INTERNAL integration
 *                           handle / capability token; a client that holds it could
 *                           address the provider session directly. STRIPPED for all.
 *   - recordingStorageKey — the raw S3/MinIO object key for the recording artifact.
 *                           An internal storage locator; never belongs in a client
 *                           response. STRIPPED for all.
 *   - meetingPin          — the dial-in PIN: the JOIN SECRET for the conference.
 *                           Returned only to session HOSTS (secretary / chairperson /
 *                           admin — the write roles that manage the session), nulled
 *                           for ordinary attendees/observers so the secret is not
 *                           broadcast to the whole participant list.
 *
 * `joinUrl` and `dialInNumber` remain for all associated readers — a participant
 * needs them to join the meeting they are invited to, and neither alone grants
 * access without the PIN.
 */

/** Internal (repo-level) VC session read model — carries every column. */
export interface VcSessionInternal {
  id: string;
  meetingId: string;
  provider: string;
  externalId: string | null;
  joinUrl: string | null;
  dialInNumber: string | null;
  meetingPin: string | null;
  recordingUrl: string | null;
  recordingStorageKey: string | null;
  status: string;
  startedAt: string | null;
  endedAt: string | null;
  failureReason: string | null;
}

/** Client-safe VC session DTO — internal identifiers removed, PIN host-gated. */
export interface VcSessionPublic {
  id: string;
  meetingId: string;
  provider: string;
  joinUrl: string | null;
  dialInNumber: string | null;
  /** The dial-in PIN — present only for session hosts; null for other readers. */
  meetingPin: string | null;
  recordingUrl: string | null;
  status: string;
  startedAt: string | null;
  endedAt: string | null;
  failureReason: string | null;
}

/**
 * Project an internal VC session into the client-safe DTO. `externalId` and
 * `recordingStorageKey` are ALWAYS dropped; `meetingPin` is included only when
 * `includeHostSecrets` is true (the caller holds a VC write / host role).
 */
export function toPublicVcSession(
  row: VcSessionInternal,
  opts: { includeHostSecrets: boolean },
): VcSessionPublic {
  return {
    id: row.id,
    meetingId: row.meetingId,
    provider: row.provider,
    joinUrl: row.joinUrl,
    dialInNumber: row.dialInNumber,
    meetingPin: opts.includeHostSecrets ? row.meetingPin : null,
    recordingUrl: row.recordingUrl,
    status: row.status,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    failureReason: row.failureReason,
  };
}
