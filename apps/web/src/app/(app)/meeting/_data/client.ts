/**
 * meeting feature — client-side API calls (mutations + interactive reads).
 *
 * Uses the app's browser client (src/lib/api/browserClient.ts) which routes
 * through the BFF proxy /api/proxy/<path> (httpOnly session cookie + device
 * headers). Paths are the gateway paths WITHOUT the /api prefix, e.g.
 * "v1/meeting/..."; the gateway then rewrites "/api/v1/meeting" → the service's
 * internal "/v1/meetings". Every function throws on non-2xx; callers show a
 * plain-language error state.
 *
 * Idempotency: the voting (initiate/cast/conclude) and attendance (check-in)
 * writes REQUIRE an `X-Idempotency-Key` header (meeting-service rejects the
 * write with 400 otherwise). We mint a UUID per call.
 */
import { browserFetch } from "@/lib/api/browserClient";
import { toHumanError, type MessageKind } from "@/lib/messages";
import { UserFacingError } from "@/lib/userFacingError";
import type {
  ActiveVote,
  CommitteeSummary,
  ConfigEntry,
  CreateMeetingInput,
  LiveAttendance,
  Meeting,
  Minutes,
  PresetName,
  VotePosition,
  VoteResults,
  VoteType,
  MajorityRule,
} from "./types";

export function idempotencyKey(): Record<string, string> {
  const c = globalThis.crypto;
  let uuid: string;
  if (typeof c?.randomUUID === "function") {
    uuid = c.randomUUID();
  } else if (typeof c?.getRandomValues === "function") {
    // Non-secure contexts expose getRandomValues but not randomUUID.
    const b = c.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
    uuid = `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  } else {
    throw new Error("A secure random source is required to create an idempotency key");
  }
  return { "x-idempotency-key": uuid };
}

/**
 * Plain-language failure message for any non-2xx response from a meeting-data
 * mutation/read. Every exported function below throws `Error(readError())`
 * and callers render that message directly as the UI's error state, so it
 * must never be (or contain) a raw HTTP status code or raw server response
 * body — see docs/ENTERPRISE-GAP-REPORT-2026-09-07.md UX-003/UX-016. This
 * module is a plain async data-fetching client, not a component, so it can't
 * use the useFormError hook; toHumanError is the same catalogued-message
 * building block that hook is built on.
 */
function readError(kind: MessageKind): string {
  const human = toHumanError(kind, { area: "meeting data" });
  return `${human.what} ${human.next}`;
}

async function send<T>(
  method: "POST" | "PATCH" | "DELETE",
  path: string,
  opts: { body?: unknown; headers?: Record<string, string> } = {},
): Promise<T> {
  const res = await browserFetch(path, {
    method,
    ...(opts.headers ? { headers: opts.headers } : {}),
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  });
  if (!res.ok) throw new UserFacingError(readError("save"));
  const text = await res.text();
  return (text ? JSON.parse(text) : {}) as T;
}

async function get<T>(path: string): Promise<T> {
  const res = await browserFetch(path);
  if (!res.ok) throw new UserFacingError(readError("load"));
  return (await res.json()) as T;
}

// ─── Interactive reads ───────────────────────────────────────────────────────

export async function fetchMeeting(meetingId: string): Promise<Meeting> {
  const out = await get<{ data: Meeting }>(`v1/meeting/${meetingId}`);
  return out.data;
}

export async function fetchLiveAttendance(meetingId: string): Promise<LiveAttendance> {
  const out = await get<{ data: LiveAttendance }>(`v1/meeting/${meetingId}/attendance/live`);
  return out.data;
}

export async function fetchActiveVotes(meetingId: string): Promise<ActiveVote[]> {
  const out = await get<{ data: ActiveVote[] }>(`v1/meeting/${meetingId}/votes/active`);
  return out.data ?? [];
}

export async function fetchVoteResults(
  meetingId: string,
  resolutionId: string,
): Promise<VoteResults> {
  const out = await get<{ data: VoteResults }>(
    `v1/meeting/${meetingId}/votes/${resolutionId}/results`,
  );
  return out.data;
}

export async function fetchMinutes(meetingId: string): Promise<Minutes | null> {
  const res = await browserFetch(`v1/meeting/${meetingId}/minutes`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(readError("load"));
  const out = (await res.json()) as { data?: Minutes };
  return out.data ?? null;
}

// ─── Meeting create ──────────────────────────────────────────────────────────

/**
 * Schedule a new meeting (COMMANDS.meetingCreate). Mirrors createMinutes /
 * initiateVote: POST, no idempotency key (meeting-core's create route
 * doesn't call requireIdempotencyKey — unlike voting/attendance), 202
 * envelope with the server-minted id.
 */
/**
 * Schedule a new meeting (COMMANDS.meetingCreate). Accepts an optional
 * idempotency key (GAP-MEETING-MEETINGS-NEW-04): minted once per form mount and
 * reused on retry so a double-submit on a slow network can't create two
 * meetings. meeting-core's create route does not *require* the header (unlike
 * voting/attendance), but honours it when present.
 */
export async function createMeeting(
  input: CreateMeetingInput,
  opts: { idempotencyKey?: string } = {},
): Promise<{ id?: string }> {
  const out = await send<{ data?: { id?: string } }>("POST", "v1/meeting", {
    body: input,
    ...(opts.idempotencyKey ? { headers: { "x-idempotency-key": opts.idempotencyKey } } : {}),
  });
  return out.data ?? {};
}

/**
 * Committees selectable for the "Committee" field on the create-meeting form.
 * Asks for the service maximum page (limit 200): the list route defaults to 50,
 * which would silently truncate the picker for a tenant with more committees.
 */
export async function listCommittees(): Promise<CommitteeSummary[]> {
  const out = await get<{ data?: Record<string, unknown>[] }>("v1/meeting/committees?limit=200");
  return (out.data ?? []).map((o) => ({
    id: typeof o.id === "string" ? o.id : "",
    name: typeof o.name === "string" ? o.name : "Untitled committee",
    type: typeof o.type === "string" ? o.type : "",
    status: typeof o.status === "string" ? o.status : "",
  }));
}

// ─── Meeting lifecycle ───────────────────────────────────────────────────────

/** Drive a state-machine transition (e.g. { toState: "in_progress" }). */
/**
 * UAT J14 / D9: meeting-service's transitionMeetingSchema is `{ version, to,
 * reason? }` (optimistic lock + target state). The console used to send
 * `{ toState }`, which the route rejects with 400, so no lifecycle button ever
 * worked. A refusal the service explains (wrong state, quorum not met, missing
 * scheduling prerequisites) is thrown as a MeetingTransitionError carrying its
 * code so the console can say why in the user's language.
 */
export class MeetingTransitionError extends UserFacingError {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "MeetingTransitionError";
  }
}

const EXPLAINED_TRANSITION_CODES = new Set([
  "MEETING_INVALID_TRANSITION",
  "MEETING_QUORUM_NOT_MET",
  "MEETING_SHORT_NOTICE",
  "VERSION_CONFLICT",
  "FORBIDDEN",
]);

export async function transitionMeeting(
  meetingId: string,
  toState: string,
  version: number,
  reason?: string,
): Promise<void> {
  const res = await browserFetch(`v1/meeting/${meetingId}/transition`, {
    method: "POST",
    body: JSON.stringify({ version, to: toState, ...(reason ? { reason } : {}) }),
  });
  if (res.ok) return;
  let code = "";
  try {
    const j = (await res.json()) as { code?: unknown };
    code = typeof j.code === "string" ? j.code : "";
  } catch { /* no JSON body */ }
  if (EXPLAINED_TRANSITION_CODES.has(code)) throw new MeetingTransitionError(code, readError("save"));
  throw new UserFacingError(readError("save"));
}

/** UAT J14: add an agenda item (meeting-service agendaItemSubmitSchema: title + outcomeType). */
export const AGENDA_OUTCOME_TYPES = ["decision", "discussion", "information", "ratification"] as const;
export type AgendaOutcomeType = (typeof AGENDA_OUTCOME_TYPES)[number];

export async function addAgendaItem(
  meetingId: string,
  input: { title: string; outcomeType: AgendaOutcomeType },
): Promise<void> {
  await send("POST", `v1/meeting/${meetingId}/agenda`, { body: input });
}

// ─── Attendance ──────────────────────────────────────────────────────────────

export async function attendanceCheckIn(
  meetingId: string,
  participantId: string,
  opts: { mode?: string; method?: string } = {},
): Promise<void> {
  // meeting-service attendanceCheckInSchema is strict and REQUIRES `method`
  // (qr|biometric|geo|vc|manual). A secretary ticking someone in on screen is
  // a manual capture; without it every check-in was a 400 (UAT J14 / M1).
  await send("POST", `v1/meeting/${meetingId}/attendance/check-in`, {
    headers: idempotencyKey(),
    body: { participantId, method: opts.method ?? "manual", ...(opts.mode ? { mode: opts.mode } : {}) },
  });
}

/** Roles meeting-service accepts on a participant (participant/domain.ts PARTICIPANT_ROLES). */
export const PARTICIPANT_ROLES = ["member", "chairperson", "secretary", "observer", "presenter"] as const;
export type ParticipantRole = (typeof PARTICIPANT_ROLES)[number];

/**
 * UAT J14 / M2: add participants to a meeting (POST /participants batch form,
 * participantsAddSchema). Requires an idempotency key. `special_invitee` is
 * deliberately not offered: it needs per-agenda-item scoping.
 */
export async function addParticipants(
  meetingId: string,
  participants: { employeeId: string; role: ParticipantRole }[],
): Promise<void> {
  await send("POST", `v1/meeting/${meetingId}/participants`, {
    headers: idempotencyKey(),
    body: { participants },
  });
}

/** Employee ids currently on a meeting's roster (fresh read, all pages). */
export async function listParticipantEmployeeIds(meetingId: string): Promise<string[]> {
  const ids: string[] = [];
  for (let offset = 0; offset < 5000; offset += 200) {
    const out = await get<{ data?: Record<string, unknown>[]; meta?: { total?: number } }>(
      `v1/meeting/${meetingId}/participants?limit=200&offset=${offset}`,
    );
    const rows = out.data ?? [];
    for (const r of rows) if (typeof r.employeeId === "string") ids.push(r.employeeId);
    if (rows.length < 200) break;
  }
  return ids;
}

/**
 * Active members of a committee as { employeeId, role }, for "add the committee
 * to this meeting". `special_invitee` members are dropped (they need agenda
 * scoping the service enforces).
 */
export async function listCommitteeMembers(
  committeeId: string,
): Promise<{ employeeId: string; role: string }[]> {
  const out = await get<{ data?: Record<string, unknown>[] }>(`v1/meeting/committees/${committeeId}/members`);
  return (out.data ?? [])
    .filter((m) => m.status === "active" && typeof m.memberId === "string" && m.role !== "special_invitee")
    .map((m) => ({ employeeId: m.memberId as string, role: typeof m.role === "string" ? m.role : "member" }));
}

export async function attendanceCheckOut(
  meetingId: string,
  participantId: string,
): Promise<void> {
  await send("POST", `v1/meeting/${meetingId}/attendance/check-out`, {
    headers: idempotencyKey(),
    body: { participantId },
  });
}

/** Secretary manual marking (present / absent / joined_late / …). */
export async function attendanceManualMark(
  meetingId: string,
  participantId: string,
  status: string,
): Promise<void> {
  await send("POST", `v1/meeting/${meetingId}/attendance/manual`, {
    headers: idempotencyKey(),
    body: { participantId, status },
  });
}

// ─── Voting ──────────────────────────────────────────────────────────────────

/** Open a resolution for voting (chairperson). Returns the accepted envelope. */
export async function initiateVote(
  meetingId: string,
  input: {
    resolutionText: string;
    voteType: VoteType;
    majorityRule?: MajorityRule;
    agendaItemId?: string;
  },
): Promise<{ id?: string }> {
  const out = await send<{ data?: { id?: string } }>(
    "POST",
    `v1/meeting/${meetingId}/votes/initiate`,
    {
      headers: idempotencyKey(),
      body: {
        resolutionText: input.resolutionText,
        voteType: input.voteType,
        ...(input.majorityRule ? { majorityRule: input.majorityRule } : {}),
        ...(input.agendaItemId ? { agendaItemId: input.agendaItemId } : {}),
      },
    },
  );
  return out.data ?? {};
}

/** Cast one ballot on an open resolution (voting member). */
export async function castVote(
  meetingId: string,
  input: { resolutionId: string; position: VotePosition; reason?: string },
): Promise<void> {
  await send("POST", `v1/meeting/${meetingId}/votes/cast`, {
    headers: idempotencyKey(),
    body: {
      resolutionId: input.resolutionId,
      position: input.position,
      ...(input.reason ? { reason: input.reason } : {}),
    },
  });
}

/** Conclude an open vote — tally + compute result per majority rule (chairperson). */
export async function concludeVote(
  meetingId: string,
  resolutionId: string,
): Promise<void> {
  await send("POST", `v1/meeting/${meetingId}/votes/${resolutionId}/conclude`, {
    headers: idempotencyKey(),
    body: {},
  });
}

// ─── Minutes (maker-checker) ─────────────────────────────────────────────────

/** Create the minutes draft for a meeting (secretary / maker). */
export async function createMinutes(
  meetingId: string,
  templateType?: string,
): Promise<{ id?: string }> {
  const out = await send<{ data?: { id?: string } }>(
    "POST",
    `v1/meeting/${meetingId}/minutes`,
    { body: templateType ? { templateType } : {} },
  );
  return out.data ?? {};
}

/** Update the draft content (secretary / maker). Optimistic-locked on version. */
export async function updateMinutes(
  meetingId: string,
  minutesId: string,
  input: { version: number; content: string; changeNote?: string },
): Promise<void> {
  await send("PATCH", `v1/meeting/${meetingId}/minutes/${minutesId}`, {
    body: {
      version: input.version,
      content: input.content,
      ...(input.changeNote ? { changeNote: input.changeNote } : {}),
    },
  });
}

/** Submit the draft into the approval workflow (secretary / maker). */
export async function submitMinutes(
  meetingId: string,
  minutesId: string,
  version: number,
): Promise<void> {
  await send("POST", `v1/meeting/${meetingId}/minutes/${minutesId}/submit`, {
    body: { version },
  });
}

/**
 * Approve the minutes (chairperson / checker). The service enforces the
 * maker-checker separation server-side (approve is chairperson-role only, the
 * drafter is a secretary) — this is the checker half of the workflow.
 */
export async function approveMinutes(
  meetingId: string,
  minutesId: string,
  input: { version: number; comments?: string },
): Promise<void> {
  await send("POST", `v1/meeting/${meetingId}/minutes/${minutesId}/approve`, {
    body: {
      version: input.version,
      ...(input.comments ? { comments: input.comments } : {}),
    },
  });
}

/** Reject the minutes back to the secretary (chairperson / checker). Comments required. */
export async function rejectMinutes(
  meetingId: string,
  minutesId: string,
  input: { version: number; rejectionComments: string },
): Promise<void> {
  await send("POST", `v1/meeting/${meetingId}/minutes/${minutesId}/reject`, {
    body: { version: input.version, rejectionComments: input.rejectionComments },
  });
}

// ─── Config engine ───────────────────────────────────────────────────────────

export async function fetchConfigNamespace(namespace: string): Promise<ConfigEntry[]> {
  const out = await get<{ items?: ConfigEntry[] }>(`v1/meeting/config/${namespace}`);
  return out.items ?? [];
}

export async function setConfig(input: {
  namespace: string;
  configKey: string;
  value: unknown;
  label?: string;
  expectedVersion?: number;
}): Promise<void> {
  await send("POST", "v1/meeting/config", {
    body: {
      namespace: input.namespace,
      configKey: input.configKey,
      value: input.value,
      ...(input.label ? { label: input.label } : {}),
      ...(input.expectedVersion ? { expectedVersion: input.expectedVersion } : {}),
    },
  });
}

/** Apply a vertical onboarding preset (board-of-directors | statutory-committee | municipal-council). */
export async function applyPreset(preset: PresetName): Promise<void> {
  await send("POST", `v1/meeting/config/presets/${preset}`, { body: {} });
}
