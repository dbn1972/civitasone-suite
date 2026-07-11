/**
 * AI-assist module — route-level integration tests (task 17.1).
 *
 * Exercises all 6 AI-assist endpoints through the in-memory Fastify app via `app.inject()`
 * (no network), against the real `meeting` Postgres schema seeded directly for reads. Auth is
 * the HS256 test bypass (JWT_ALGORITHM=HS256 / JWT_SECRET from vitest.config.ts). Per the suite
 * hard rule, every endpoint is covered for happy path + 400 (validation) + 401 (unauthenticated)
 * + 403 (unauthorized role) + 404 (not found) where the endpoint has resource semantics.
 *
 *   async AI writes (transcribe / draft-minutes / extract-actions) → 202 { data: { meetingId,
 *                    status: "accepted", correlationId } } (command queued via the memory queue)
 *   sync  AI reads  (transcript / suggest-agenda / knowledge-base) → 200 { data }
 *
 * Safety posture (Req 16.5, P37): none of these endpoints publish or approve content — the write
 * endpoints only enqueue a job whose consumer writes an editable draft / pending-confirmation
 * candidate; a human must approve minutes / confirm actions elsewhere. The routes are the CQRS
 * boundary, so these tests assert the accept/validate/authorize contract, not consumer effects.
 *
 * _Requirements: 7.2, 16.1, 16.2, 16.3, 16.4, 16.5, 16.6, 16.7_
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "a1a1a1a1-0000-4000-8000-0000000017a1";
const OTHER_TENANT = "a2a2a2a2-0000-4000-8000-0000000017a2";
const ACTOR = "99999999-0000-4000-8000-0000000017a1";

const MEETING = "bbbb1111-0000-4000-8000-0000000017a1";
const COMMITTEE = "cccc2222-0000-4000-8000-0000000017a1";
const TRANSCRIPT_DOC = "dddd3333-0000-4000-8000-0000000017a1";
const MISSING = "00000000-0000-4000-8000-0000000017ff";

function token(roles: string[], tid: string = TENANT): string {
  return signToken({ sub: ACTOR, tid, roles, sid: "sess-ai" }, SECRET, 3600);
}
function auth(roles: string[], tid: string = TENANT) {
  return { authorization: `Bearer ${token(roles, tid)}` };
}

let app: FastifyInstance;

beforeAll(async () => {
  // Idempotent seed: clear then insert the fixture graph for the test tenant.
  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`DELETE FROM meeting.meeting_documents WHERE tenant_id = ${TENANT}`;
  });
  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`DELETE FROM meeting.agenda_items WHERE tenant_id = ${TENANT}`;
  });
  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`DELETE FROM meeting.committees WHERE tenant_id = ${TENANT}`;
  });
  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`DELETE FROM meeting.meetings WHERE tenant_id = ${TENANT}`;
  });

  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`
    INSERT INTO meeting.committees
      (id, tenant_id, name, code, type, constitution_date, quorum_rule, created_by, updated_by)
    VALUES (${COMMITTEE}, ${TENANT}, 'Standing Committee', 'SC', 'standing', '2025-01-01',
            ${'{"minMembers":2}'}::jsonb, ${ACTOR}, ${ACTOR})`;
  });

  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`
    INSERT INTO meeting.meetings
      (id, tenant_id, type, title, status, committee_id, scheduled_at, created_by, updated_by)
    VALUES (${MEETING}, ${TENANT}, 'committee', 'AI Test Meeting', 'minutes_pending', ${COMMITTEE},
            '2025-06-01T09:00:00Z', ${ACTOR}, ${ACTOR})`;
  });

  // A prior agenda item so suggest-agenda has recurring-item context to surface.
  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`
    INSERT INTO meeting.agenda_items
      (tenant_id, meeting_id, sequence, title, outcome_type, status, created_by, updated_by)
    VALUES (${TENANT}, ${MEETING}, 1, 'Budget review', 'decision', 'accepted', ${ACTOR}, ${ACTOR})`;
  });

  // A stored transcript artifact so GET .../ai/transcript returns 200 (metadata is authoritative;
  // the object body is fetched best-effort and may be null without live object storage).
  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`
    INSERT INTO meeting.meeting_documents
      (id, tenant_id, meeting_id, file_name, mime_type, storage_key, hash, document_type,
       created_by, updated_by)
    VALUES (${TRANSCRIPT_DOC}, ${TENANT}, ${MEETING}, ${"transcript-" + MEETING + ".txt"}, 'text/plain',
            ${"ai/transcripts/" + TENANT + "/" + MEETING + ".txt"},
            ${"a".repeat(64)}, 'transcript', ${ACTOR}, ${ACTOR})`;
  });

  app = await buildApp();
});

afterAll(async () => {
  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`DELETE FROM meeting.meeting_documents WHERE tenant_id = ${TENANT}`;
  });
  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`DELETE FROM meeting.agenda_items WHERE tenant_id = ${TENANT}`;
  });
  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`DELETE FROM meeting.committees WHERE tenant_id = ${TENANT}`;
  });
  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`DELETE FROM meeting.meetings WHERE tenant_id = ${TENANT}`;
  });
  await app.close();
  await sqlClient.end();
});

// ─── POST /ai/transcribe ─────────────────────────────────────────────────────
describe("POST /v1/meetings/:meetingId/ai/transcribe", () => {
  const url = `/v1/meetings/${MEETING}/ai/transcribe`;
  const body = { recordingRef: "meeting/recordings/rec-1.mp4" };

  it("202 accepts a transcription job from the secretariat", async () => {
    const res = await app.inject({ method: "POST", url, headers: auth(["committee_secretary"]), payload: body });
    expect(res.statusCode).toBe(202);
    const data = res.json().data;
    expect(data.status).toBe("accepted");
    expect(data.meetingId).toBe(MEETING);
    expect(data.correlationId).toBeTruthy();
  });

  it("400 when recordingRef is missing", async () => {
    const res = await app.inject({ method: "POST", url, headers: auth(["committee_secretary"]), payload: {} });
    expect(res.statusCode).toBe(400);
  });

  it("401 without a token", async () => {
    const res = await app.inject({ method: "POST", url, payload: body });
    expect(res.statusCode).toBe(401);
  });

  it("403 for a role without AI-initiate rights", async () => {
    const res = await app.inject({ method: "POST", url, headers: auth(["committee_member"]), payload: body });
    expect(res.statusCode).toBe(403);
  });

  it("404 when the meeting does not exist", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/${MISSING}/ai/transcribe`,
      headers: auth(["committee_secretary"]),
      payload: body,
    });
    expect(res.statusCode).toBe(404);
  });

  it("404 under a different tenant (isolation — meeting not visible)", async () => {
    const res = await app.inject({ method: "POST", url, headers: auth(["committee_secretary"], OTHER_TENANT), payload: body });
    expect(res.statusCode).toBe(404);
  });
});

// ─── GET /ai/transcript ──────────────────────────────────────────────────────
describe("GET /v1/meetings/:meetingId/ai/transcript", () => {
  const url = `/v1/meetings/${MEETING}/ai/transcript`;

  it("200 returns the stored transcript metadata for an authorized reader", async () => {
    const res = await app.inject({ method: "GET", url, headers: auth(["committee_member"]) });
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.documentId).toBe(TRANSCRIPT_DOC);
    expect(data.meetingId).toBe(MEETING);
  });

  it("401 without a token", async () => {
    const res = await app.inject({ method: "GET", url });
    expect(res.statusCode).toBe(401);
  });

  it("403 for a role outside the meeting roles", async () => {
    const res = await app.inject({ method: "GET", url, headers: auth(["employee"]) });
    expect(res.statusCode).toBe(403);
  });

  it("404 when the meeting has no transcript", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/meetings/${MISSING}/ai/transcript`, headers: auth(["committee_member"]) });
    expect(res.statusCode).toBe(404);
  });
});

// ─── POST /ai/draft-minutes ──────────────────────────────────────────────────
describe("POST /v1/meetings/:meetingId/ai/draft-minutes", () => {
  const url = `/v1/meetings/${MEETING}/ai/draft-minutes`;

  it("202 accepts an AI minutes-draft job (empty body ⇒ defaults)", async () => {
    const res = await app.inject({ method: "POST", url, headers: auth(["committee_secretary"]), payload: {} });
    expect(res.statusCode).toBe(202);
    expect(res.json().data.status).toBe("accepted");
  });

  it("202 with an explicit template type", async () => {
    const res = await app.inject({ method: "POST", url, headers: auth(["meeting_admin"]), payload: { templateType: "summary" } });
    expect(res.statusCode).toBe(202);
  });

  it("400 for an invalid template type", async () => {
    const res = await app.inject({ method: "POST", url, headers: auth(["committee_secretary"]), payload: { templateType: "bogus" } });
    expect(res.statusCode).toBe(400);
  });

  it("401 without a token", async () => {
    const res = await app.inject({ method: "POST", url, payload: {} });
    expect(res.statusCode).toBe(401);
  });

  it("403 for a role without AI-initiate rights", async () => {
    const res = await app.inject({ method: "POST", url, headers: auth(["observer"]), payload: {} });
    expect(res.statusCode).toBe(403);
  });

  it("404 when the meeting does not exist", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/meetings/${MISSING}/ai/draft-minutes`, headers: auth(["committee_secretary"]), payload: {} });
    expect(res.statusCode).toBe(404);
  });
});

// ─── POST /ai/extract-actions ────────────────────────────────────────────────
describe("POST /v1/meetings/:meetingId/ai/extract-actions", () => {
  const url = `/v1/meetings/${MEETING}/ai/extract-actions`;

  it("202 accepts an action-extraction job", async () => {
    const res = await app.inject({ method: "POST", url, headers: auth(["committee_secretary"]), payload: {} });
    expect(res.statusCode).toBe(202);
    expect(res.json().data.status).toBe("accepted");
  });

  it("400 for a non-uuid transcriptRef", async () => {
    const res = await app.inject({ method: "POST", url, headers: auth(["committee_secretary"]), payload: { transcriptRef: "not-a-uuid" } });
    expect(res.statusCode).toBe(400);
  });

  it("401 without a token", async () => {
    const res = await app.inject({ method: "POST", url, payload: {} });
    expect(res.statusCode).toBe(401);
  });

  it("403 for a role without AI-initiate rights", async () => {
    const res = await app.inject({ method: "POST", url, headers: auth(["committee_member"]), payload: {} });
    expect(res.statusCode).toBe(403);
  });

  it("404 when the meeting does not exist", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/meetings/${MISSING}/ai/extract-actions`, headers: auth(["committee_secretary"]), payload: {} });
    expect(res.statusCode).toBe(404);
  });
});

// ─── POST /ai/suggest-agenda (synchronous) ───────────────────────────────────
describe("POST /v1/meetings/:meetingId/ai/suggest-agenda", () => {
  const url = `/v1/meetings/${MEETING}/ai/suggest-agenda`;

  it("200 returns agenda suggestions (heuristic provider, offline)", async () => {
    const res = await app.inject({ method: "POST", url, headers: auth(["committee_secretary"]), payload: {} });
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(Array.isArray(data.suggestions)).toBe(true);
    expect(data.suggestions.length).toBeGreaterThanOrEqual(1);
    expect(data.degraded).toBe(false);
  });

  it("400 for a non-uuid committeeId", async () => {
    const res = await app.inject({ method: "POST", url, headers: auth(["committee_secretary"]), payload: { committeeId: "nope" } });
    expect(res.statusCode).toBe(400);
  });

  it("401 without a token", async () => {
    const res = await app.inject({ method: "POST", url, payload: {} });
    expect(res.statusCode).toBe(401);
  });

  it("403 for a role without AI-initiate rights", async () => {
    const res = await app.inject({ method: "POST", url, headers: auth(["observer"]), payload: {} });
    expect(res.statusCode).toBe(403);
  });

  it("404 when the meeting does not exist", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/meetings/${MISSING}/ai/suggest-agenda`, headers: auth(["committee_secretary"]), payload: {} });
    expect(res.statusCode).toBe(404);
  });
});

// ─── POST /search/knowledge-base (synchronous) ───────────────────────────────
describe("POST /v1/meetings/search/knowledge-base", () => {
  const url = `/v1/meetings/search/knowledge-base`;

  it("200 returns a (possibly degraded) result envelope for an authorized reader", async () => {
    const res = await app.inject({ method: "POST", url, headers: auth(["committee_member"]), payload: { q: "budget policy" } });
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(Array.isArray(data.hits)).toBe(true);
    expect(typeof data.totalHits).toBe("number");
    expect(typeof data.degraded).toBe("boolean");
  });

  it("400 for an empty query string", async () => {
    const res = await app.inject({ method: "POST", url, headers: auth(["committee_member"]), payload: { q: "" } });
    expect(res.statusCode).toBe(400);
  });

  it("401 without a token", async () => {
    const res = await app.inject({ method: "POST", url, payload: { q: "budget" } });
    expect(res.statusCode).toBe(401);
  });

  it("403 for a role outside the meeting roles", async () => {
    const res = await app.inject({ method: "POST", url, headers: auth(["employee"]), payload: { q: "budget" } });
    expect(res.statusCode).toBe(403);
  });
});
