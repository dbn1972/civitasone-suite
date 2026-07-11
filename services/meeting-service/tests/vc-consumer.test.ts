/**
 * VC-integration module — consumer integration tests (task 14.2) against the real DB.
 *
 * Exercises the VC command handlers end-to-end against Postgres inside `runWithTenant(TENANT, …)`
 * (sets the `app.tenant_id` GUC for RLS, exactly as the worker does via `withTenantConsumer`). The
 * provider fallback chain is injected via `__setVcChainFactory` so provisioning is deterministic
 * (no real provider/network): a stub chain returns a session, a circuit-breaker-open chain forces
 * a provider SWITCH, and an all-unavailable chain forces the `VC_ALL_PLATFORMS_UNAVAILABLE` path.
 * Object storage (@civitasone/storage) is mocked so recording persistence needs no MinIO.
 *
 * Focus (per task 14.2):
 *   • create → INSERT vc_sessions + UPDATE meetings.vc_link (Req 13.2, 13.4)
 *   • circuit-breaker fallback → session persisted under the fallback provider + secretary notified
 *     of the switch (Req 13.5)
 *   • all providers unavailable → session recorded `failed` + VC_ALL_PLATFORMS_UNAVAILABLE alert
 *     (Req 13.5/13.6)
 *   • webhook → INSERT VC-presence attendance (method = vc) + attendance.marked event (Req 13.3, 6.7)
 *   • idempotency (P30) — processing the SAME messageId twice yields exactly one row/effect
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

// Object storage is mocked (recording manifest persistence in vc.end_session).
vi.mock("@civitasone/storage", () => ({
  putObject: vi.fn(async () => undefined),
  getObject: vi.fn(async () => Buffer.from("{}", "utf8")),
  deleteObject: vi.fn(async () => undefined),
  presignedGetUrl: vi.fn(async () => "https://s3.mock/presigned"),
}));

import { runWithTenant } from "@civitasone/db";
import { NonRetryableError, type CommandEnvelope } from "@civitasone/queue";
import { sqlClient } from "../src/shared/db.js";
import { COMMANDS, EVENTS } from "../src/topics.js";
import { registerVcConsumers } from "../src/modules/vc-integration/consumer.js";
import { __setVcChainFactory } from "../src/modules/vc-integration/provider.js";
import {
  VCAllPlatformsUnavailableError,
  type VCFallbackChain,
  type VCProvider,
  type VCSessionResult,
} from "../src/modules/vc-integration/adapter.js";

const TENANT = "a7a7a7a7-0000-4000-8000-0000000000c2";
const ACTOR = "90000000-0000-4000-8000-0000000000c2";
const SECRETARY = "5ec00000-0000-4000-8000-0000000000c2";
const MEETING = "b7b7b7b7-0000-4000-8000-0000000000c2";
const P_MEMBER = "e2222222-0000-4000-8000-0000000000c2";
const MEMBER_EMP = "f2222222-0000-4000-8000-0000000000c2";

const handlers = new Map<string, (msg: CommandEnvelope<any>) => Promise<void>>();
registerVcConsumers((topic, h) => handlers.set(topic, h as any));

function msg<T>(type: string, payload: T, messageId = randomUUID()): CommandEnvelope<T> {
  return { messageId, type, tenantId: TENANT, actorId: ACTOR, correlationId: randomUUID(), schemaVersion: "1.0", payload } as CommandEnvelope<T>;
}

function run<T>(m: CommandEnvelope<T>): Promise<void> {
  const handler = handlers.get(m.type);
  if (!handler) throw new Error(`no handler for ${m.type}`);
  return runWithTenant(TENANT, () => handler(m)) as Promise<void>;
}

/** A stub adapter whose calls are all no-ops (used for adapterFor in start/stop/end handlers). */
const noopAdapter = {
  provider: "webrtc" as VCProvider,
  createSession: async () => ({ externalId: "x", joinUrl: "https://x" }),
  getJoinLink: async () => "https://x",
  getParticipants: async () => [],
  startRecording: async () => undefined,
  stopRecording: async () => ({ recordingUrl: "https://rec/x.mp4", storageKey: "vc-recordings/webrtc/x.mp4", durationSeconds: 60, sizeBytes: 1024 }),
  endSession: async () => undefined,
};

/** A chain that always serves a session from `served`, reporting `switchedFrom`. */
function servingChain(served: VCProvider, switchedFrom: VCProvider | null): VCFallbackChain {
  return {
    providers: [served],
    isProviderAvailable: () => true,
    adapterFor: () => noopAdapter,
    createSession: async (): Promise<VCSessionResult> => ({
      provider: served,
      switchedFrom,
      attempts: [],
      session: {
        externalId: `${served}-ext-abc`,
        joinUrl: `https://vc.${served}.local/join/abc`,
        dialInNumber: "+91-11-4000-0000",
        meetingPin: "123456789",
      },
    }),
  };
}

/** A chain that fails every provider → VC_ALL_PLATFORMS_UNAVAILABLE. */
function unavailableChain(): VCFallbackChain {
  return {
    providers: ["nic_vc", "webrtc"],
    isProviderAvailable: () => false,
    adapterFor: () => noopAdapter,
    createSession: async (): Promise<VCSessionResult> => {
      throw new VCAllPlatformsUnavailableError([
        { provider: "nic_vc", reason: "circuit_open" },
        { provider: "webrtc", reason: "circuit_open" },
      ]);
    },
  };
}

async function readSession(id: string): Promise<any | null> {
  return runWithTenant(TENANT, async () => {
    const rows = await sqlClient.begin(async (sql) => {
      await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
      return sql`select id, provider, join_url, status, failure_reason, recording_storage_key
                 from meeting.vc_sessions where id = ${id}`;
    });
    return rows[0] ?? null;
  });
}

async function readMeetingVcLink(): Promise<{ vc_link: string | null; vc_enabled: boolean } | null> {
  return runWithTenant(TENANT, async () => {
    const rows = await sqlClient.begin(async (sql) => {
      await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
      return sql`select vc_link, vc_enabled from meeting.meetings where id = ${MEETING}`;
    });
    return rows[0] ?? null;
  });
}

async function attendanceCount(): Promise<number> {
  const rows = await runWithTenant(TENANT, () =>
    sqlClient.begin(async (sql) => {
      await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
      return sql`select count(*)::int as n from meeting.attendance_records
                 where meeting_id = ${MEETING} and participant_id = ${P_MEMBER} and mode = 'vc'`;
    }),
  );
  return rows[0].n as number;
}

async function outboxCount(topic: string): Promise<number> {
  const rows = await runWithTenant(TENANT, () =>
    sqlClient.begin(async (sql) => {
      await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
      return sql`select count(*)::int as n from _outbox.messages where tenant_id = ${TENANT} and topic = ${topic}`;
    }),
  );
  return rows[0].n as number;
}

beforeAll(async () => {
  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`
      insert into meeting.meetings
        (id, tenant_id, type, title, status, chairperson_id, secretary_id, scheduled_at, duration_minutes, created_by, updated_by)
      values (${MEETING}, ${TENANT}, 'committee', 'VC Consumer', 'scheduled', ${ACTOR}, ${SECRETARY},
              now() + interval '2 days', 90, ${ACTOR}, ${ACTOR})
      on conflict (id) do nothing`;
    await sql`
      insert into meeting.participants
        (id, tenant_id, meeting_id, employee_id, role, invitation_status, created_by, updated_by)
      values (${P_MEMBER}, ${TENANT}, ${MEETING}, ${MEMBER_EMP}, 'member', 'accepted', ${ACTOR}, ${ACTOR})
      on conflict (id) do nothing`;
  });
});

afterEach(() => {
  __setVcChainFactory(null);
});

afterAll(async () => {
  __setVcChainFactory(null);
  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`delete from meeting.attendance_records where tenant_id = ${TENANT}`;
    await sql`delete from meeting.vc_sessions where tenant_id = ${TENANT}`;
    await sql`delete from meeting.participants where tenant_id = ${TENANT}`;
    await sql`delete from meeting.meetings where tenant_id = ${TENANT}`;
    await sql`delete from _outbox.messages where tenant_id = ${TENANT}`;
  });
  await sqlClient.end();
});

describe("vc.create_session", () => {
  it("provisions the session, persists the join link, and is idempotent on redelivery (P30)", async () => {
    __setVcChainFactory(() => servingChain("nic_vc", null));
    const vcSessionId = randomUUID();
    const m = msg(COMMANDS.vcSessionCreate, { vcSessionId, meetingId: MEETING, tenantId: TENANT, recordingEnabled: false });

    await run(m);
    const row = await readSession(vcSessionId);
    expect(row).toBeTruthy();
    expect(row.provider).toBe("nic_vc");
    expect(row.status).toBe("created");
    expect(row.join_url).toContain("vc.nic_vc.local");

    const meeting = await readMeetingVcLink();
    expect(meeting?.vc_link).toContain("vc.nic_vc.local");
    expect(meeting?.vc_enabled).toBe(true);
    expect(await outboxCount(EVENTS.vcSessionCreated)).toBeGreaterThan(0);

    // Redelivery with the SAME messageId is a no-op (markProcessed skip) — still exactly one row.
    await run(m);
    const count = await runWithTenant(TENANT, () =>
      sqlClient.begin(async (sql) => {
        await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
        return sql`select count(*)::int as n from meeting.vc_sessions where id = ${vcSessionId}`;
      }),
    );
    expect(count[0].n).toBe(1);
  });

  it("records a fallback provider switch and notifies the secretary (Req 13.5)", async () => {
    __setVcChainFactory(() => servingChain("ms_teams", "nic_vc"));
    const vcSessionId = randomUUID();
    const notifyBefore = await outboxCount("notification.send");

    await run(msg(COMMANDS.vcSessionCreate, { vcSessionId, meetingId: MEETING, tenantId: TENANT }));

    const row = await readSession(vcSessionId);
    expect(row.provider).toBe("ms_teams"); // persisted under the provider that actually served
    // A secretary notification about the platform switch was emitted (Req 13.5).
    expect(await outboxCount("notification.send")).toBe(notifyBefore + 1);
  });

  it("records a failed session + VC_ALL_PLATFORMS_UNAVAILABLE alert when all providers are down (Req 13.5/13.6)", async () => {
    __setVcChainFactory(() => unavailableChain());
    const vcSessionId = randomUUID();
    const alertsBefore = await outboxCount(EVENTS.complianceAlert);

    // Terminal business outcome — recorded, NOT thrown (no retry storm).
    await run(msg(COMMANDS.vcSessionCreate, { vcSessionId, meetingId: MEETING, tenantId: TENANT }));

    const row = await readSession(vcSessionId);
    expect(row.status).toBe("failed");
    expect(row.failure_reason).toBe("VC_ALL_PLATFORMS_UNAVAILABLE");
    expect(await outboxCount(EVENTS.complianceAlert)).toBe(alertsBefore + 1);
  });

  it("rejects create for an unknown meeting (permanent → DLQ)", async () => {
    __setVcChainFactory(() => servingChain("nic_vc", null));
    await expect(
      run(msg(COMMANDS.vcSessionCreate, { vcSessionId: randomUUID(), meetingId: randomUUID(), tenantId: TENANT })),
    ).rejects.toBeInstanceOf(NonRetryableError);
  });
});

describe("vc.end_session", () => {
  it("ends the session, persists the recording location, and emits vc.session_ended", async () => {
    __setVcChainFactory(() => servingChain("nic_vc", null));
    const vcSessionId = randomUUID();
    await run(msg(COMMANDS.vcSessionCreate, { vcSessionId, meetingId: MEETING, tenantId: TENANT }));

    const endedBefore = await outboxCount(EVENTS.vcSessionEnded);
    await run(msg(COMMANDS.vcSessionEnd, { vcSessionId, meetingId: MEETING, tenantId: TENANT }));

    const row = await readSession(vcSessionId);
    expect(row.status).toBe("ended");
    expect(row.recording_storage_key).toBe("vc-recordings/webrtc/x.mp4");
    expect(await outboxCount(EVENTS.vcSessionEnded)).toBe(endedBefore + 1);
  });
});

describe("vc.recording_start / vc.recording_stop", () => {
  it("start marks the session active + stamps started_at; stop persists the recording location", async () => {
    __setVcChainFactory(() => servingChain("nic_vc", null));
    const vcSessionId = randomUUID();
    await run(msg(COMMANDS.vcSessionCreate, { vcSessionId, meetingId: MEETING, tenantId: TENANT }));

    await run(msg(COMMANDS.vcRecordingStart, { vcSessionId, meetingId: MEETING, tenantId: TENANT }));
    let row = await readSession(vcSessionId);
    expect(row.status).toBe("active");

    await run(msg(COMMANDS.vcRecordingStop, { vcSessionId, meetingId: MEETING, tenantId: TENANT }));
    row = await readSession(vcSessionId);
    expect(row.recording_storage_key).toBe("vc-recordings/webrtc/x.mp4");
  });

  it("rejects a recording toggle for a session that does not belong to the meeting (permanent → DLQ)", async () => {
    __setVcChainFactory(() => servingChain("nic_vc", null));
    await expect(
      run(msg(COMMANDS.vcRecordingStart, { vcSessionId: randomUUID(), meetingId: MEETING, tenantId: TENANT })),
    ).rejects.toBeInstanceOf(NonRetryableError);
  });
});

describe("vc.webhook → VC-presence attendance (Req 13.3, 6.7)", () => {
  it("inserts a vc attendance record + attendance.marked event, idempotently (P30)", async () => {
    const attMarkedBefore = await outboxCount(EVENTS.attendanceMarked);
    const m = msg(COMMANDS.vcWebhook, {
      meetingId: MEETING,
      tenantId: TENANT,
      participantId: P_MEMBER,
      event: "participant.joined",
      joinedAt: new Date().toISOString(),
      externalUserId: "nic-ext-1",
    });

    await run(m);
    expect(await attendanceCount()).toBe(1);
    expect(await outboxCount(EVENTS.vcParticipantJoined)).toBeGreaterThan(0);
    expect(await outboxCount(EVENTS.attendanceMarked)).toBe(attMarkedBefore + 1);

    // Redelivery (same messageId) is a no-op — still exactly one attendance record.
    await run(m);
    expect(await attendanceCount()).toBe(1);
  });

  it("rejects a webhook for a participant that does not belong to the meeting (permanent → DLQ)", async () => {
    await expect(
      run(msg(COMMANDS.vcWebhook, {
        meetingId: MEETING,
        tenantId: TENANT,
        participantId: randomUUID(),
        event: "participant.joined",
      })),
    ).rejects.toBeInstanceOf(NonRetryableError);
  });
});
