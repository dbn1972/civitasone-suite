/**
 * VC-integration module — HTTP route tests (task 14.2) via `app.inject()`.
 *
 * Exercises all seven VC endpoints across the mandated axes: happy path + 400 (validation /
 * missing idempotency key) + 401 (unauthenticated) + 403 (wrong role) + 404 (unknown
 * meeting/session) + 503 (VC_PROVIDER_UNAVAILABLE on create when all providers' breakers are open).
 *
 * Auth: HS256 test bypass (JWT_ALGORITHM=HS256, JWT_SECRET from vitest.config.ts).
 * Data: a scheduled meeting + one participant + one VC session are seeded directly (RLS-aware,
 * `app.tenant_id` GUC set inside the seed transaction) and torn down afterwards. Writes are CQRS
 * (publish → 202) against the in-memory queue; no worker runs, so the command is enqueued but not
 * consumed — exactly the boundary these tests assert.
 *
 * The provider fallback chain is injected via `__setVcChainFactory` so the 503 path (all providers
 * unavailable) is deterministic and no real provider/breaker is involved.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { __setVcChainFactory } from "../src/modules/vc-integration/provider.js";
import type { VCFallbackChain } from "../src/modules/vc-integration/adapter.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-7c3d-4a1a-9b2c-00000000c1a1";
const MEETING = "cccccccc-7c3d-4a1a-9b2c-00000000c1a1";
const MISSING_MEETING = "dddddddd-7c3d-4a1a-9b2c-00000000c1a1";
const P_MEMBER = "e2222222-7c3d-4a1a-9b2c-00000000c1a1";
const MEMBER_EMP = "f2222222-7c3d-4a1a-9b2c-00000000c1a1";
const SESSION = "5e551011-7c3d-4a1a-9b2c-00000000c1a1";
const MISSING_SESSION = "5e559999-7c3d-4a1a-9b2c-00000000c1a1";
const ACTOR = "0a000000-7c3d-4a1a-9b2c-00000000c1a1";

const IDEMPOTENCY = { "x-idempotency-key": "vc-test-key-0001" } as const;

function token(roles: string[] = ["committee_secretary"], tid: string = TENANT): string {
  return signToken({ sub: ACTOR, tid, roles, sid: "sess-vc" }, SECRET);
}

/** A fake chain reporting every provider available (create → 202) or none (create → 503). */
function fakeChain(available: boolean): VCFallbackChain {
  return {
    providers: ["nic_vc", "webrtc"],
    isProviderAvailable: () => available,
    adapterFor: () => null,
    createSession: async () => {
      throw new Error("not used in route tests");
    },
  };
}

let app: Awaited<ReturnType<typeof buildApp>>;

beforeAll(async () => {
  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`
      insert into meeting.meetings
        (id, tenant_id, type, title, status, chairperson_id, secretary_id, scheduled_at, vc_enabled, created_by, updated_by)
      values (${MEETING}, ${TENANT}, 'committee', 'VC Review', 'scheduled', ${ACTOR}, ${ACTOR},
              now() + interval '3 days', true, ${ACTOR}, ${ACTOR})
      on conflict (id) do nothing`;
    await sql`
      insert into meeting.participants
        (id, tenant_id, meeting_id, employee_id, role, invitation_status, created_by, updated_by)
      values (${P_MEMBER}, ${TENANT}, ${MEETING}, ${MEMBER_EMP}, 'member', 'accepted', ${ACTOR}, ${ACTOR})
      on conflict (id) do nothing`;
    await sql`
      insert into meeting.vc_sessions
        (id, tenant_id, meeting_id, provider, external_id, join_url, status, created_by, updated_by)
      values (${SESSION}, ${TENANT}, ${MEETING}, 'nic_vc', 'nic_vc-ext-1',
              'https://vc.nic.in/join/nic_vc-ext-1', 'created', ${ACTOR}, ${ACTOR})
      on conflict (id) do nothing`;
  });
  app = await buildApp();
});

afterEach(() => {
  __setVcChainFactory(null);
});

afterAll(async () => {
  __setVcChainFactory(null);
  if (app) await app.close();
  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`delete from meeting.vc_sessions where meeting_id = ${MEETING}`;
    await sql`delete from meeting.participants where meeting_id = ${MEETING}`;
    await sql`delete from meeting.meetings where id = ${MEETING}`;
  });
  await sqlClient.end();
});

// ─── POST /vc/create ──────────────────────────────────────────────────────────

describe("POST /v1/meetings/:meetingId/vc/create", () => {
  it("401 when unauthenticated", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/meetings/${MEETING}/vc/create`, payload: {} });
    expect(res.statusCode).toBe(401);
  });

  it("403 for a role without write access", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/${MEETING}/vc/create`,
      headers: { authorization: `Bearer ${token(["observer"])}`, ...IDEMPOTENCY },
      payload: {},
    });
    expect(res.statusCode).toBe(403);
  });

  it("400 when the X-Idempotency-Key header is missing", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/${MEETING}/vc/create`,
      headers: { authorization: `Bearer ${token()}` },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("400 for an invalid platform", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/${MEETING}/vc/create`,
      headers: { authorization: `Bearer ${token()}`, ...IDEMPOTENCY },
      payload: { platform: "skype" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("404 for an unknown meeting", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/${MISSING_MEETING}/vc/create`,
      headers: { authorization: `Bearer ${token()}`, ...IDEMPOTENCY },
      payload: {},
    });
    expect(res.statusCode).toBe(404);
  });

  it("503 when every configured VC provider is unavailable (Req 13.5)", async () => {
    __setVcChainFactory(() => fakeChain(false));
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/${MEETING}/vc/create`,
      headers: { authorization: `Bearer ${token()}`, ...IDEMPOTENCY },
      payload: { platform: "nic_vc" },
    });
    expect(res.statusCode).toBe(503);
    expect(res.json().code).toBe("VC_PROVIDER_UNAVAILABLE");
  });

  it("202 accepts a valid create when a provider is available", async () => {
    __setVcChainFactory(() => fakeChain(true));
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/${MEETING}/vc/create`,
      headers: { authorization: `Bearer ${token(["meeting_admin"])}`, ...IDEMPOTENCY },
      payload: { recordingEnabled: true },
    });
    expect(res.statusCode).toBe(202);
    const { data } = res.json();
    expect(data.status).toBe("accepted");
    expect(data.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.headers.location).toBe(`/v1/meetings/${MEETING}/vc/session`);
  });
});

// ─── GET /vc/session ────────────────────────────────────────────────────────────

describe("GET /v1/meetings/:meetingId/vc/session", () => {
  it("401 when unauthenticated", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/meetings/${MEETING}/vc/session` });
    expect(res.statusCode).toBe(401);
  });

  it("403 for a role without read access", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/meetings/${MEETING}/vc/session`,
      headers: { authorization: `Bearer ${token(["citizen"])}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it("404 for an unknown meeting", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/meetings/${MISSING_MEETING}/vc/session`,
      headers: { authorization: `Bearer ${token()}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it("200 with the seeded session", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/meetings/${MEETING}/vc/session`,
      headers: { authorization: `Bearer ${token(["committee_member"])}` },
    });
    expect(res.statusCode).toBe(200);
    const { data } = res.json();
    expect(data.id).toBe(SESSION);
    expect(data.provider).toBe("nic_vc");
    expect(data.joinUrl).toContain("vc.nic.in");
  });
});

// ─── POST /vc/start-recording ───────────────────────────────────────────────────

describe("POST /v1/meetings/:meetingId/vc/start-recording", () => {
  it("401 when unauthenticated", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/${MEETING}/vc/start-recording`,
      payload: { vcSessionId: SESSION },
    });
    expect(res.statusCode).toBe(401);
  });

  it("403 for a role without write access", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/${MEETING}/vc/start-recording`,
      headers: { authorization: `Bearer ${token(["committee_member"])}`, ...IDEMPOTENCY },
      payload: { vcSessionId: SESSION },
    });
    expect(res.statusCode).toBe(403);
  });

  it("400 when the X-Idempotency-Key header is missing", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/${MEETING}/vc/start-recording`,
      headers: { authorization: `Bearer ${token()}` },
      payload: { vcSessionId: SESSION },
    });
    expect(res.statusCode).toBe(400);
  });

  it("400 for a missing vcSessionId", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/${MEETING}/vc/start-recording`,
      headers: { authorization: `Bearer ${token()}`, ...IDEMPOTENCY },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("404 for an unknown session", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/${MEETING}/vc/start-recording`,
      headers: { authorization: `Bearer ${token()}`, ...IDEMPOTENCY },
      payload: { vcSessionId: MISSING_SESSION },
    });
    expect(res.statusCode).toBe(404);
  });

  it("202 accepts a valid start-recording", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/${MEETING}/vc/start-recording`,
      headers: { authorization: `Bearer ${token()}`, ...IDEMPOTENCY },
      payload: { vcSessionId: SESSION },
    });
    expect(res.statusCode).toBe(202);
    expect(res.json().data.id).toBe(SESSION);
  });
});

// ─── POST /vc/stop-recording ────────────────────────────────────────────────────

describe("POST /v1/meetings/:meetingId/vc/stop-recording", () => {
  it("401 when unauthenticated", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/${MEETING}/vc/stop-recording`,
      payload: { vcSessionId: SESSION },
    });
    expect(res.statusCode).toBe(401);
  });

  it("403 for a role without write access", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/${MEETING}/vc/stop-recording`,
      headers: { authorization: `Bearer ${token(["observer"])}`, ...IDEMPOTENCY },
      payload: { vcSessionId: SESSION },
    });
    expect(res.statusCode).toBe(403);
  });

  it("400 when the X-Idempotency-Key header is missing", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/${MEETING}/vc/stop-recording`,
      headers: { authorization: `Bearer ${token()}` },
      payload: { vcSessionId: SESSION },
    });
    expect(res.statusCode).toBe(400);
  });

  it("404 for an unknown session", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/${MEETING}/vc/stop-recording`,
      headers: { authorization: `Bearer ${token()}`, ...IDEMPOTENCY },
      payload: { vcSessionId: MISSING_SESSION },
    });
    expect(res.statusCode).toBe(404);
  });

  it("202 accepts a valid stop-recording", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/${MEETING}/vc/stop-recording`,
      headers: { authorization: `Bearer ${token()}`, ...IDEMPOTENCY },
      payload: { vcSessionId: SESSION },
    });
    expect(res.statusCode).toBe(202);
    expect(res.json().data.id).toBe(SESSION);
  });
});

// ─── POST /vc/end ─────────────────────────────────────────────────────────────

describe("POST /v1/meetings/:meetingId/vc/end", () => {
  it("401 when unauthenticated", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/${MEETING}/vc/end`,
      payload: { vcSessionId: SESSION },
    });
    expect(res.statusCode).toBe(401);
  });

  it("403 for a role without write access", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/${MEETING}/vc/end`,
      headers: { authorization: `Bearer ${token(["committee_member"])}`, ...IDEMPOTENCY },
      payload: { vcSessionId: SESSION },
    });
    expect(res.statusCode).toBe(403);
  });

  it("400 when the X-Idempotency-Key header is missing", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/${MEETING}/vc/end`,
      headers: { authorization: `Bearer ${token()}` },
      payload: { vcSessionId: SESSION },
    });
    expect(res.statusCode).toBe(400);
  });

  it("404 for an unknown session", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/${MEETING}/vc/end`,
      headers: { authorization: `Bearer ${token()}`, ...IDEMPOTENCY },
      payload: { vcSessionId: MISSING_SESSION },
    });
    expect(res.statusCode).toBe(404);
  });

  it("202 accepts a valid end", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/${MEETING}/vc/end`,
      headers: { authorization: `Bearer ${token()}`, ...IDEMPOTENCY },
      payload: { vcSessionId: SESSION },
    });
    expect(res.statusCode).toBe(202);
    expect(res.json().data.id).toBe(SESSION);
  });
});

// ─── GET /vc/participants ────────────────────────────────────────────────────────

describe("GET /v1/meetings/:meetingId/vc/participants", () => {
  it("401 when unauthenticated", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/meetings/${MEETING}/vc/participants` });
    expect(res.statusCode).toBe(401);
  });

  it("403 for a role without read access", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/meetings/${MEETING}/vc/participants`,
      headers: { authorization: `Bearer ${token(["citizen"])}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it("404 for an unknown meeting", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/meetings/${MISSING_MEETING}/vc/participants`,
      headers: { authorization: `Bearer ${token()}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it("200 with the (initially empty) VC-presence roster", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/meetings/${MEETING}/vc/participants`,
      headers: { authorization: `Bearer ${token(["committee_member"])}` },
    });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json().data)).toBe(true);
  });
});

// ─── POST /vc/webhook ──────────────────────────────────────────────────────────

describe("POST /v1/meetings/:meetingId/vc/webhook", () => {
  it("401 when unauthenticated", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/${MEETING}/vc/webhook`,
      payload: { participantId: P_MEMBER },
    });
    expect(res.statusCode).toBe(401);
  });

  it("403 for a role that is not a VC service caller", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/${MEETING}/vc/webhook`,
      headers: { authorization: `Bearer ${token(["committee_member"])}` },
      payload: { participantId: P_MEMBER },
    });
    expect(res.statusCode).toBe(403);
  });

  it("400 for a non-uuid participantId", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/${MEETING}/vc/webhook`,
      headers: { authorization: `Bearer ${token(["vc_service"])}` },
      payload: { participantId: "not-a-uuid" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("404 for an unknown meeting", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/${MISSING_MEETING}/vc/webhook`,
      headers: { authorization: `Bearer ${token(["vc_service"])}` },
      payload: { participantId: P_MEMBER },
    });
    expect(res.statusCode).toBe(404);
  });

  it("202 accepts a valid webhook WITHOUT an X-Idempotency-Key (exempt)", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/${MEETING}/vc/webhook`,
      headers: { authorization: `Bearer ${token(["vc_service"])}` },
      payload: { participantId: P_MEMBER, joinedAt: new Date().toISOString(), externalUserId: "nic-ext-99" },
    });
    expect(res.statusCode).toBe(202);
    expect(res.json().data.id).toBe(P_MEMBER);
  });
});
