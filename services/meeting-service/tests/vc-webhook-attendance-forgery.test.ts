/**
 * vc-integration — vc.webhook accepts VC-presence attendance with NO live-session check
 * (audit finding, extends tests/vc-consumer.test.ts's "vc.webhook" coverage).
 *
 * `handleWebhook` (src/modules/vc-integration/consumer.ts:525-587) records a participant as
 * `attending_via_vc` when it receives a `vc.webhook` command. Compare it to its three siblings
 * in the SAME file: `handleRecordingStart` (:352), `handleRecordingStop` (:393), and
 * `handleSessionEnd` (:438) EACH call `loadSession(tx, p.vcSessionId, tenantId)` and refuse to
 * act on a session that does not exist / does not belong to the meeting / is already
 * `ended`/`failed` (the terminal-status guard: "if (session.status === STATUS_ENDED ...) return").
 * `handleWebhook` does none of this:
 *   - `vcWebhookSchema.vcSessionId` (validators.ts:63) is OPTIONAL — a webhook need not even
 *     name a session;
 *   - even when supplied, `handleWebhook` never calls `loadSession` — `vcSessionId` is only
 *     ever passed through into the emitted event payload (consumer.ts:571-572), never validated
 *     against the actual `vc_sessions` row's existence or `status`.
 *
 * Consequence: attendance recorded this way feeds quorum/attendance directly (Req 6.7, 13.3;
 * see attendance/domain.ts quorum computation) — the same governance-integrity concern the
 * audit brief raises for ai-assist's human-approval invariant applies here: a fabricated
 * "attended via VC" record can manufacture quorum for decisions/resolutions/votes that
 * legally require it, for a meeting that never actually had a live, current VC session.
 *
 * Reachability: `VC_WEBHOOK_ROLES` (routes.ts:66) = ["meeting_admin", "vc_service",
 * "tenant_admin", "super_admin"] — despite the module doc comment calling this "a
 * service-to-service callback ... not an end-user role", three of those four role strings
 * (`meeting_admin`, `tenant_admin`, `super_admin`) are the SAME ordinary human administrative
 * roles used everywhere else in this service (see vc-integration/routes.ts VC_WRITE_ROLES,
 * document/routes.ts WRITE_ROLES) — there is no separate service-credential mechanism gating
 * this route; any human holding one of those roles can call it directly over HTTP.
 *
 * This file exercises the consumer handler directly (matching tests/vc-consumer.test.ts's own
 * `run()` / `msg()` pattern) — the same code path the HTTP route's command publish reaches.
 *
 * Severity: HIGH — no live-session existence/activity check on an attendance-creating,
 * quorum-relevant event. Live-proven against the real Postgres DB.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

// Object storage is mocked (recording manifest persistence in vc.end_session) — mirrors
// tests/vc-consumer.test.ts so ending a session needs no live MinIO.
vi.mock("@civitasone/storage", () => ({
  putObject: vi.fn(async () => undefined),
  getObject: vi.fn(async () => Buffer.from("{}", "utf8")),
  deleteObject: vi.fn(async () => undefined),
  presignedGetUrl: vi.fn(async () => "https://s3.mock/presigned"),
}));

import { runWithTenant } from "@civitasone/db";
import type { CommandEnvelope } from "@civitasone/queue";
import { sqlClient } from "../src/shared/db.js";
import { COMMANDS, EVENTS } from "../src/topics.js";
import { registerVcConsumers } from "../src/modules/vc-integration/consumer.js";
import { __setVcChainFactory } from "../src/modules/vc-integration/provider.js";
import type { VCFallbackChain, VCProvider, VCSessionResult } from "../src/modules/vc-integration/adapter.js";

const TENANT = "a8a8a8a8-0000-4000-8000-0000000c1a56";
const ACTOR = "90000000-0000-4000-8000-0000000c1a56";
const SECRETARY = "5ec00000-0000-4000-8000-0000000c1a56";
const MEETING_NO_SESSION = "b8b80001-0000-4000-8000-0000000c1a56";
const MEETING_ENDED_SESSION = "b8b80002-0000-4000-8000-0000000c1a56";
const PARTICIPANT_A = "e8880001-0000-4000-8000-0000000c1a56";
const EMP_A = "f8880001-0000-4000-8000-0000000c1a56";
const PARTICIPANT_B = "e8880002-0000-4000-8000-0000000c1a56";
const EMP_B = "f8880002-0000-4000-8000-0000000c1a56";

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

const noopAdapter = {
  provider: "webrtc" as VCProvider,
  createSession: async () => ({ externalId: "x", joinUrl: "https://x" }),
  getJoinLink: async () => "https://x",
  getParticipants: async () => [],
  startRecording: async () => undefined,
  stopRecording: async () => ({ recordingUrl: "https://rec/x.mp4", storageKey: "vc-recordings/webrtc/x.mp4", durationSeconds: 60, sizeBytes: 1024 }),
  endSession: async () => undefined,
};
function servingChain(): VCFallbackChain {
  return {
    providers: ["webrtc"],
    isProviderAvailable: () => true,
    adapterFor: () => noopAdapter,
    createSession: async (): Promise<VCSessionResult> => ({
      provider: "webrtc",
      switchedFrom: null,
      attempts: [],
      session: { externalId: "webrtc-ext-forge", joinUrl: "https://vc.webrtc.local/join/forge" },
    }),
  };
}

async function attendanceRows(meetingId: string): Promise<any[]> {
  return runWithTenant(TENANT, () =>
    sqlClient.begin(async (sql) => {
      await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
      return sql`select participant_id, status, method, mode from meeting.attendance_records
                 where meeting_id = ${meetingId} order by created_at`;
    }),
  );
}

async function vcSessionCount(meetingId: string): Promise<number> {
  const rows = await runWithTenant(TENANT, () =>
    sqlClient.begin(async (sql) => {
      await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
      return sql`select count(*)::int as n from meeting.vc_sessions where meeting_id = ${meetingId}`;
    }),
  );
  return rows[0].n as number;
}

beforeAll(async () => {
  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    for (const meetingId of [MEETING_NO_SESSION, MEETING_ENDED_SESSION]) {
      await sql`
        insert into meeting.meetings
          (id, tenant_id, type, title, status, chairperson_id, secretary_id, scheduled_at, duration_minutes, created_by, updated_by)
        values (${meetingId}, ${TENANT}, 'committee', 'Webhook Forgery Test', 'scheduled', ${ACTOR}, ${SECRETARY},
                now() + interval '1 day', 60, ${ACTOR}, ${ACTOR})
        on conflict (id) do nothing`;
    }
    await sql`
      insert into meeting.participants
        (id, tenant_id, meeting_id, employee_id, role, invitation_status, created_by, updated_by)
      values (${PARTICIPANT_A}, ${TENANT}, ${MEETING_NO_SESSION}, ${EMP_A}, 'member', 'accepted', ${ACTOR}, ${ACTOR})
      on conflict (id) do nothing`;
    await sql`
      insert into meeting.participants
        (id, tenant_id, meeting_id, employee_id, role, invitation_status, created_by, updated_by)
      values (${PARTICIPANT_B}, ${TENANT}, ${MEETING_ENDED_SESSION}, ${EMP_B}, 'member', 'accepted', ${ACTOR}, ${ACTOR})
      on conflict (id) do nothing`;
  });
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

describe("BUG: vc.webhook records quorum-relevant attendance with no live-session check", () => {
  it("a meeting that NEVER had a VC session provisioned still accepts a webhook 'joined' claim (vcSessionId omitted entirely, exactly like the happy-path test in vc-consumer.test.ts)", async () => {
    expect(await vcSessionCount(MEETING_NO_SESSION)).toBe(0); // no vc_sessions row exists at all

    await run(
      msg(COMMANDS.vcWebhook, {
        meetingId: MEETING_NO_SESSION,
        tenantId: TENANT,
        participantId: PARTICIPANT_A,
        event: "participant.joined",
        joinedAt: new Date().toISOString(),
        externalUserId: "forged-ext-1",
        // vcSessionId intentionally omitted — the schema allows it (validators.ts:63 `.optional()`)
        // and the consumer never requires or checks it.
      }),
    );

    const rows = await attendanceRows(MEETING_NO_SESSION);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("attending_via_vc");
    expect(rows[0].mode).toBe("vc");
    // This attendance row is now indistinguishable from a real VC join to every downstream
    // consumer (quorum computation, minutes attendance list) — yet no VC session, live or
    // otherwise, was ever associated with this meeting.
  });

  it("a webhook claiming a specific, ALREADY-ENDED vcSessionId is still accepted — the id is never resolved or checked", async () => {
    __setVcChainFactory(() => servingChain());
    const vcSessionId = randomUUID();
    await run(msg(COMMANDS.vcSessionCreate, { vcSessionId, meetingId: MEETING_ENDED_SESSION, tenantId: TENANT, recordingEnabled: false }));
    await run(msg(COMMANDS.vcSessionEnd, { vcSessionId, meetingId: MEETING_ENDED_SESSION, tenantId: TENANT }));

    const ended = await runWithTenant(TENANT, () =>
      sqlClient.begin(async (sql) => {
        await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
        return sql`select status from meeting.vc_sessions where id = ${vcSessionId}`;
      }),
    );
    expect(ended[0].status).toBe("ended"); // the session is genuinely, verifiably over

    // A webhook arrives "late" (replay, race, or a forged call from anyone holding
    // meeting_admin/tenant_admin/super_admin — all ordinary human roles per VC_WEBHOOK_ROLES)
    // naming the now-ended session. handleWebhook never loads it, so nothing rejects this.
    await run(
      msg(COMMANDS.vcWebhook, {
        meetingId: MEETING_ENDED_SESSION,
        tenantId: TENANT,
        participantId: PARTICIPANT_B,
        vcSessionId, // the ENDED session's id — sibling handlers would refuse to act on this
        event: "participant.joined",
        joinedAt: new Date().toISOString(),
      }),
    );

    const rows = await attendanceRows(MEETING_ENDED_SESSION);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("attending_via_vc");

    // Contrast: handleRecordingStart / handleRecordingStop DO refuse to act on this exact same
    // ended session (the terminal-status guard) — proving the omission in handleWebhook is a
    // real inconsistency, not a deliberate design choice applied uniformly across the module.
    await expect(
      run(msg(COMMANDS.vcRecordingStart, { vcSessionId, meetingId: MEETING_ENDED_SESSION, tenantId: TENANT })),
    ).resolves.toBeUndefined(); // resolves — but as a documented terminal no-op, not an error
    const stillEnded = await runWithTenant(TENANT, () =>
      sqlClient.begin(async (sql) => {
        await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
        return sql`select status from meeting.vc_sessions where id = ${vcSessionId}`;
      }),
    );
    expect(stillEnded[0].status).toBe("ended"); // recording-start correctly refused to reactivate it
    expect(await outboxHas(EVENTS.attendanceMarked, MEETING_ENDED_SESSION)).toBe(true);
  });
});

async function outboxHas(topic: string, meetingId: string): Promise<boolean> {
  const rows = await runWithTenant(TENANT, () =>
    sqlClient.begin(async (sql) => {
      await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
      return sql`select payload from _outbox.messages where tenant_id = ${TENANT} and topic = ${topic}`;
    }),
  );
  return rows.some((r: any) => r.payload?.meetingId === meetingId);
}
