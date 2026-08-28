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

function idempotencyKey(): Record<string, string> {
  const uuid =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return { "x-idempotency-key": uuid };
}

async function readError(res: Response): Promise<string> {
  try {
    const text = await res.text();
    if (!text) return `Request failed (${res.status})`;
    try {
      const j = JSON.parse(text) as { message?: string; code?: string };
      return j.message ?? j.code ?? text;
    } catch {
      return text;
    }
  } catch {
    return `Request failed (${res.status})`;
  }
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
  if (!res.ok) throw new Error(await readError(res));
  const text = await res.text();
  return (text ? JSON.parse(text) : {}) as T;
}

async function get<T>(path: string): Promise<T> {
  const res = await browserFetch(path);
  if (!res.ok) throw new Error(await readError(res));
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
  if (!res.ok) throw new Error(await readError(res));
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
export async function createMeeting(input: CreateMeetingInput): Promise<{ id?: string }> {
  const out = await send<{ data?: { id?: string } }>("POST", "v1/meeting", { body: input });
  return out.data ?? {};
}

/** Committees selectable for the "Committee" field on the create-meeting form. */
export async function listCommittees(): Promise<CommitteeSummary[]> {
  const out = await get<{ data?: Record<string, unknown>[] }>("v1/meeting/committees");
  return (out.data ?? []).map((o) => ({
    id: typeof o.id === "string" ? o.id : "",
    name: typeof o.name === "string" ? o.name : "Untitled committee",
    type: typeof o.type === "string" ? o.type : "",
    status: typeof o.status === "string" ? o.status : "",
  }));
}

// ─── Meeting lifecycle ───────────────────────────────────────────────────────

/** Drive a state-machine transition (e.g. { toState: "in_progress" }). */
export async function transitionMeeting(
  meetingId: string,
  toState: string,
  reason?: string,
): Promise<void> {
  await send("POST", `v1/meeting/${meetingId}/transition`, {
    body: { toState, ...(reason ? { reason } : {}) },
  });
}

// ─── Attendance ──────────────────────────────────────────────────────────────

export async function attendanceCheckIn(
  meetingId: string,
  participantId: string,
  opts: { mode?: string } = {},
): Promise<void> {
  await send("POST", `v1/meeting/${meetingId}/attendance/check-in`, {
    headers: idempotencyKey(),
    body: { participantId, ...(opts.mode ? { mode: opts.mode } : {}) },
  });
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
