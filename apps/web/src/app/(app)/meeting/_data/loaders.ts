/**
 * meeting feature — server-side loaders (Server Components only).
 *
 * Follows the app convention (see src/app/_data/apiClient.ts): every loader
 * returns LoaderResult<T> = { data, source } and never throws. On any failure
 * (no base URL, 401, network, bad shape) it returns empty data with
 * source:"error" so pages degrade gracefully via <DataSourceBadge/>.
 *
 * Gateway routing: paths are prefixed "/api/v1/meeting/..." — the gateway
 * (services/gateway-service/src/registry.ts) rewrites the "/api/v1/meeting"
 * prefix to the service's internal base "/v1/meetings" (plural). So
 *   GET /api/v1/meeting              → GET /v1/meetings          (list)
 *   GET /api/v1/meeting/:id          → GET /v1/meetings/:id
 *   GET /api/v1/meeting/:id/agenda   → GET /v1/meetings/:id/agenda
 *   GET /api/v1/meeting/config/:ns   → GET /v1/meetings/config/:ns
 */
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import type {
  ActiveVote,
  AgendaItem,
  ConfigEntry,
  LiveAttendance,
  Meeting,
  MeetingStatus,
  Minutes,
  MinutesStatus,
  Resolution,
  VoteResults,
  VoteTally,
} from "./types";

// ─── small coercers ──────────────────────────────────────────────────────────

function pickData(payload: unknown): unknown {
  if (payload && typeof payload === "object" && "data" in payload) {
    return (payload as { data: unknown }).data;
  }
  return payload;
}

function asArray(x: unknown): Record<string, unknown>[] {
  return Array.isArray(x) ? (x as Record<string, unknown>[]) : [];
}

function asObj(x: unknown): Record<string, unknown> | null {
  return x && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>) : null;
}

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : v == null ? fallback : String(v);
}

function strOrNull(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function num(v: unknown, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function bool(v: unknown): boolean {
  return v === true;
}

// ─── mappers ─────────────────────────────────────────────────────────────────

function mapMeeting(o: Record<string, unknown>): Meeting {
  return {
    id: str(o.id),
    type: str(o.type, "committee"),
    title: str(o.title),
    description: strOrNull(o.description),
    status: str(o.status, "draft") as MeetingStatus,
    committeeId: strOrNull(o.committeeId),
    chairpersonId: strOrNull(o.chairpersonId),
    secretaryId: strOrNull(o.secretaryId),
    scheduledAt: strOrNull(o.scheduledAt),
    actualStartAt: strOrNull(o.actualStartAt),
    actualEndAt: strOrNull(o.actualEndAt),
    durationMinutes: num(o.durationMinutes, 60),
    venue: strOrNull(o.venue),
    vcEnabled: bool(o.vcEnabled),
    vcLink: strOrNull(o.vcLink),
    confidentialityLevel: str(o.confidentialityLevel, "internal"),
    quorumEstablished: bool(o.quorumEstablished),
    quorumEstablishedAt: strOrNull(o.quorumEstablishedAt),
    meetingNumber: strOrNull(o.meetingNumber),
    financialYear: strOrNull(o.financialYear),
    version: num(o.version, 1),
  };
}

function mapMeetings(payload: unknown): Meeting[] {
  return asArray(pickData(payload)).map(mapMeeting);
}

function mapAgenda(payload: unknown): AgendaItem[] {
  return asArray(pickData(payload)).map((o) => ({
    id: str(o.id),
    meetingId: str(o.meetingId),
    sequence: num(o.sequence),
    title: str(o.title),
    description: strOrNull(o.description),
    outcomeType: str(o.outcomeType),
    durationMinutes: num(o.durationMinutes, 15),
    presenterId: strOrNull(o.presenterId),
    status: str(o.status, "proposed"),
    category: strOrNull(o.category),
    linkedDecisionId: strOrNull(o.linkedDecisionId),
    version: num(o.version, 1),
  }));
}

function mapTally(v: unknown): VoteTally {
  const o = asObj(v) ?? {};
  return {
    votesFor: num(o.votesFor),
    votesAgainst: num(o.votesAgainst),
    votesAbstain: num(o.votesAbstain),
    total: num(o.total),
  };
}

function mapLiveAttendance(payload: unknown): LiveAttendance | null {
  const o = asObj(pickData(payload));
  if (!o) return null;
  const c = asObj(o.counts) ?? {};
  return {
    meetingId: str(o.meetingId),
    generatedAt: str(o.generatedAt),
    counts: {
      present: num(c.present),
      absent: num(c.absent),
      joinedLate: num(c.joinedLate),
      leftEarly: num(c.leftEarly),
      attendingViaVc: num(c.attendingViaVc),
      total: num(c.total),
    },
    participants: asArray(o.participants).map((p) => ({
      participantId: str(p.participantId),
      employeeId: str(p.employeeId),
      role: str(p.role),
      isMandatory: bool(p.isMandatory),
      status: str(p.status, "absent"),
      mode: strOrNull(p.mode),
      method: strOrNull(p.method),
      checkInAt: strOrNull(p.checkInAt),
      checkOutAt: strOrNull(p.checkOutAt),
    })),
  };
}

function mapActiveVotes(payload: unknown): ActiveVote[] {
  return asArray(pickData(payload)).map((o) => ({
    resolutionId: str(o.resolutionId),
    meetingId: str(o.meetingId),
    resolutionNumber: str(o.resolutionNumber),
    text: str(o.text),
    voteType: str(o.voteType),
    majorityRule: str(o.majorityRule, "simple_majority"),
    status: str(o.status),
    isCirculation: bool(o.isCirculation),
    tally: mapTally(o.tally),
    circulationDeadline: strOrNull(o.circulationDeadline),
    createdAt: str(o.createdAt),
  }));
}

function mapVoteResults(payload: unknown): VoteResults | null {
  const o = asObj(pickData(payload));
  if (!o || !o.resolutionId) return null;
  return {
    resolutionId: str(o.resolutionId),
    meetingId: str(o.meetingId),
    resolutionNumber: str(o.resolutionNumber),
    status: str(o.status),
    voteType: str(o.voteType),
    majorityRule: str(o.majorityRule, "simple_majority"),
    isCirculation: bool(o.isCirculation),
    tally: mapTally(o.tally),
    result: str(o.result, "pending"),
    projectedResult: str(o.projectedResult, "pending"),
    approvalPercentage: num(o.approvalPercentage),
    effectiveDate: strOrNull(o.effectiveDate),
    responseRate: typeof o.responseRate === "number" ? o.responseRate : null,
    concluded: bool(o.concluded),
    dscSignerName: strOrNull(o.dscSignerName),
    hashCurrent: strOrNull(o.hashCurrent),
    secret: bool(o.secret),
    positions: asArray(o.positions).map((p) => ({
      memberId: strOrNull(p.memberId) ?? undefined,
      memberName: strOrNull(p.memberName) ?? undefined,
      position: strOrNull(p.position) ?? undefined,
      reason: strOrNull(p.reason),
    })),
  };
}

function mapResolutions(payload: unknown): Resolution[] {
  return asArray(pickData(payload)).map((o) => ({
    id: str(o.id),
    meetingId: str(o.meetingId),
    resolutionNumber: str(o.resolutionNumber),
    text: str(o.text),
    voteType: str(o.voteType),
    votesFor: num(o.votesFor),
    votesAgainst: num(o.votesAgainst),
    votesAbstain: num(o.votesAbstain),
    majorityRule: str(o.majorityRule, "simple_majority"),
    result: str(o.result, "pending"),
    status: str(o.status),
    effectiveDate: strOrNull(o.effectiveDate),
    isCirculation: bool(o.isCirculation),
  }));
}

function mapMinutes(payload: unknown): Minutes | null {
  const o = asObj(pickData(payload));
  if (!o || !o.id) return null;
  return {
    id: str(o.id),
    meetingId: str(o.meetingId),
    templateType: str(o.templateType, "summary"),
    content: str(o.content),
    status: str(o.status, "draft") as MinutesStatus,
    currentVersion: num(o.currentVersion, 1),
    approvedBy: strOrNull(o.approvedBy),
    approvedAt: strOrNull(o.approvedAt),
    dscSignerName: strOrNull(o.dscSignerName),
    dscSignedAt: strOrNull(o.dscSignedAt),
    hashCurrent: strOrNull(o.hashCurrent),
    createdBy: str(o.createdBy),
    createdAt: strOrNull(o.createdAt),
    updatedAt: strOrNull(o.updatedAt),
    version: num(o.version, 1),
  };
}

function mapConfig(payload: unknown): ConfigEntry[] {
  // config-registry responds with { items, count, source } (not { data }).
  const items =
    payload && typeof payload === "object" && "items" in payload
      ? (payload as { items: unknown }).items
      : pickData(payload);
  return asArray(items).map((o) => ({
    id: str(o.id),
    namespace: str(o.namespace),
    configKey: str(o.configKey),
    value: o.value,
    label: strOrNull(o.label),
    description: strOrNull(o.description),
    active: o.active !== false,
    sortOrder: num(o.sortOrder),
    version: num(o.version, 1),
  }));
}

// ─── loaders ─────────────────────────────────────────────────────────────────

/** List meetings, newest first. Optional status filter (e.g. "in_progress"). */
export function getMeetings(status?: MeetingStatus): Promise<LoaderResult<Meeting[]>> {
  const qs = status ? `?status=${status}` : "";
  return fetchJson<unknown, Meeting[]>(`/api/v1/meeting${qs}`, [], {
    revalidateSeconds: 15,
    telemetryKey: `meeting.list.${status ?? "all"}`,
    mapResponse: mapMeetings,
  });
}

export function getMeeting(meetingId: string): Promise<LoaderResult<Meeting | null>> {
  return fetchJson<unknown, Meeting | null>(
    `/api/v1/meeting/${encodeURIComponent(meetingId)}`,
    null,
    {
      telemetryKey: "meeting.detail",
      mapResponse: (p) => {
        const o = asObj(pickData(p));
        return o && o.id ? mapMeeting(o) : null;
      },
    },
  );
}

export function getAgenda(meetingId: string): Promise<LoaderResult<AgendaItem[]>> {
  return fetchJson<unknown, AgendaItem[]>(
    `/api/v1/meeting/${encodeURIComponent(meetingId)}/agenda`,
    [],
    {
      revalidateSeconds: 15,
      telemetryKey: "meeting.agenda",
      mapResponse: mapAgenda,
    },
  );
}

export function getLiveAttendance(
  meetingId: string,
): Promise<LoaderResult<LiveAttendance | null>> {
  return fetchJson<unknown, LiveAttendance | null>(
    `/api/v1/meeting/${encodeURIComponent(meetingId)}/attendance/live`,
    null,
    {
      telemetryKey: "meeting.attendance.live",
      mapResponse: mapLiveAttendance,
    },
  );
}

export function getActiveVotes(meetingId: string): Promise<LoaderResult<ActiveVote[]>> {
  return fetchJson<unknown, ActiveVote[]>(
    `/api/v1/meeting/${encodeURIComponent(meetingId)}/votes/active`,
    [],
    {
      telemetryKey: "meeting.votes.active",
      mapResponse: mapActiveVotes,
    },
  );
}

export function getVoteResults(
  meetingId: string,
  resolutionId: string,
): Promise<LoaderResult<VoteResults | null>> {
  return fetchJson<unknown, VoteResults | null>(
    `/api/v1/meeting/${encodeURIComponent(meetingId)}/votes/${encodeURIComponent(resolutionId)}/results`,
    null,
    {
      telemetryKey: "meeting.votes.results",
      mapResponse: mapVoteResults,
    },
  );
}

/** A meeting's full vote register — resolutions (open + concluded), for the minutes record. */
export function getResolutions(meetingId: string): Promise<LoaderResult<Resolution[]>> {
  return fetchJson<unknown, Resolution[]>(
    `/api/v1/meeting/${encodeURIComponent(meetingId)}/resolutions`,
    [],
    {
      telemetryKey: "meeting.resolutions",
      mapResponse: mapResolutions,
    },
  );
}

/** A meeting's minutes. The service returns 404 when none exists yet → source:"error". */
export function getMinutes(meetingId: string): Promise<LoaderResult<Minutes | null>> {
  return fetchJson<unknown, Minutes | null>(
    `/api/v1/meeting/${encodeURIComponent(meetingId)}/minutes`,
    null,
    {
      telemetryKey: "meeting.minutes",
      mapResponse: mapMinutes,
    },
  );
}

/** All config entries in a namespace (e.g. "meeting_policy", "meeting_types"). */
export function getConfigNamespace(namespace: string): Promise<LoaderResult<ConfigEntry[]>> {
  return fetchJson<unknown, ConfigEntry[]>(
    `/api/v1/meeting/config/${encodeURIComponent(namespace)}`,
    [],
    {
      revalidateSeconds: 30,
      telemetryKey: `meeting.config.${namespace}`,
      mapResponse: mapConfig,
    },
  );
}
