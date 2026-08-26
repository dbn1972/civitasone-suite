/**
 * ai-assist × document — classification-clearance bypass on GET /ai/transcript (audit finding).
 *
 * `document` module's routes (routes.ts `loadReadableDocument`) enforce classification-based
 * clearance on every read of a `meeting.meeting_documents` row (Req 15.5, 19.3, 19.7):
 * `canAccessClassification(ctx.roles, doc.classification)` — an unauthorized Secret/Top_Secret
 * read 404s (existence never leaked). AI-assist's transcript is stored in the SAME table
 * (`document_type = 'transcript'`, `classification` inherited from the meeting's
 * `confidentialityLevel` — see ai-assist/consumer.ts:323, ai-assist/schema.ts) via a second,
 * independent Drizzle binding of that table — but `ai-assist/routes.ts` GET
 * `/v1/meetings/:meetingId/ai/transcript` and `ai-assist/repo.ts` `getTranscript` apply NO
 * classification check at all, only the broad `READ_ROLES` role list (which includes
 * `committee_member` / `observer` — roles capped at `confidential`/`internal` clearance by
 * `document/validators.ts` `maxClearanceRank`).
 *
 * This file proves the SAME transcript row is:
 *   - correctly 404'd (existence hidden) via the document module's own route, and
 *   - fully served (200, metadata + content) via ai-assist's sibling route,
 * for identical caller roles — i.e. the classification gate is trivially bypassed by going
 * through the sibling module that shares the underlying table.
 *
 * RLS FORCE on `meeting.meeting_documents` (migrations/0005) still holds — this is NOT a
 * cross-tenant leak, only a same-tenant clearance-ceiling bypass. Severity: HIGH — a `secret`
 * or `top_secret` meeting's verbatim transcript (arguably more sensitive than any single
 * attached document, since it is the raw proceedings) is exposed to any tenant user holding a
 * broad meeting-read role, regardless of clearance.
 *
 * Static file:line citations:
 *   - src/modules/ai-assist/routes.ts:80-88   GET /ai/transcript — requireRole(READ_ROLES) only
 *   - src/modules/ai-assist/repo.ts:59-105    getTranscript — no classification predicate/filter
 *   - src/modules/document/routes.ts:96-102   loadReadableDocument — canAccessClassification gate
 *   - src/modules/document/validators.ts:147-156 maxClearanceRank / canAccessClassification
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "a3a3a3a3-0000-4000-8000-0000000c1a55";
const ACTOR = "90000000-0000-4000-8000-0000000c1a55";

const COMMITTEE = "cc330000-0000-4000-8000-0000000c1a55";
const MEETING = "bb330000-0000-4000-8000-0000000c1a55";
const TOP_SECRET_TRANSCRIPT = "dd330001-0000-4000-8000-0000000c1a55";
const SECRET_TRANSCRIPT = "dd330002-0000-4000-8000-0000000c1a55";

function token(roles: string[]): string {
  return signToken({ sub: ACTOR, tid: TENANT, roles, sid: "sess-classify" }, SECRET, 3600);
}
function auth(roles: string[]) {
  return { authorization: `Bearer ${token(roles)}` };
}

let app: FastifyInstance;

beforeAll(async () => {
  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`DELETE FROM meeting.meeting_documents WHERE tenant_id = ${TENANT}`;
    await sql`DELETE FROM meeting.meetings WHERE tenant_id = ${TENANT}`;
    await sql`DELETE FROM meeting.committees WHERE tenant_id = ${TENANT}`;
  });

  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`
    INSERT INTO meeting.committees
      (id, tenant_id, name, code, type, constitution_date, quorum_rule, created_by, updated_by)
    VALUES (${COMMITTEE}, ${TENANT}, 'Classified Ops Committee', 'COC', 'standing', '2025-01-01',
            ${'{"minMembers":2}'}::jsonb, ${ACTOR}, ${ACTOR})`;
  });

  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`
    INSERT INTO meeting.meetings
      (id, tenant_id, type, title, status, committee_id, confidentiality_level, scheduled_at, created_by, updated_by)
    VALUES (${MEETING}, ${TENANT}, 'committee', 'Top Secret Briefing', 'minutes_pending', ${COMMITTEE},
            'top_secret', '2025-06-01T09:00:00Z', ${ACTOR}, ${ACTOR})`;
  });

  // A top_secret transcript, exactly as ai-assist's handleAiTranscribe would persist it
  // (classification := meeting.confidentialityLevel, document_type := 'transcript').
  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`
    INSERT INTO meeting.meeting_documents
      (id, tenant_id, meeting_id, file_name, mime_type, storage_key, hash, classification,
       document_type, created_by, updated_by)
    VALUES (${TOP_SECRET_TRANSCRIPT}, ${TENANT}, ${MEETING}, ${"transcript-" + MEETING + ".txt"}, 'text/plain',
            ${"ai/transcripts/" + TENANT + "/" + MEETING + ".txt"}, ${"b".repeat(64)}, 'top_secret',
            'transcript', ${ACTOR}, ${ACTOR})`;
    // A second, 'secret'-classified transcript version for the mid-tier-role case.
    await sql`
    INSERT INTO meeting.meeting_documents
      (id, tenant_id, meeting_id, file_name, mime_type, storage_key, hash, classification,
       document_type, created_by, updated_by)
    VALUES (${SECRET_TRANSCRIPT}, ${TENANT}, ${MEETING}, ${"transcript-secret-" + MEETING + ".txt"}, 'text/plain',
            ${"ai/transcripts/" + TENANT + "/" + MEETING + "-secret.txt"}, ${"c".repeat(64)}, 'secret',
            'transcript', ${ACTOR}, ${ACTOR})`;
  });

  app = await buildApp();
});

afterAll(async () => {
  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`DELETE FROM meeting.meeting_documents WHERE tenant_id = ${TENANT}`;
    await sql`DELETE FROM meeting.meetings WHERE tenant_id = ${TENANT}`;
    await sql`DELETE FROM meeting.committees WHERE tenant_id = ${TENANT}`;
  });
  await app.close();
  await sqlClient.end();
});

describe("classification bypass: GET /ai/transcript vs GET /documents/:documentId", () => {
  it("sanity: the fixture row really is persisted as top_secret (not silently downgraded)", async () => {
    const rows = await sqlClient.begin(async (sql) => {
      await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
      return sql`select classification from meeting.meeting_documents where id = ${TOP_SECRET_TRANSCRIPT}`;
    });
    expect(rows[0].classification).toBe("top_secret");
  });

  it("document module correctly 404s an unauthorized observer on the top_secret transcript row (Req 19.7 control group)", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/meetings/${MEETING}/documents/${TOP_SECRET_TRANSCRIPT}`,
      headers: auth(["observer"]),
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("MEETING_UNAUTHORIZED_ACCESS");
  });

  it("BUG: ai-assist serves the SAME top_secret transcript row 200 to the SAME unauthorized observer", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/meetings/${MEETING}/ai/transcript`,
      headers: auth(["observer"]),
    });
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    // Metadata (existence, hash, filename) is leaked at minimum; the body too when storage is
    // reachable. Either way this is exactly the outcome Req 19.7 says must never happen for an
    // uncleared reader of a top_secret artifact.
    expect(data.documentId).toBe(TOP_SECRET_TRANSCRIPT);
    expect(data.hash).toBe("b".repeat(64));
  });

  it("document module correctly 404s a committee_member (confidential-tier, rank 2) on the secret transcript row", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/meetings/${MEETING}/documents/${SECRET_TRANSCRIPT}`,
      headers: auth(["committee_member"]),
    });
    expect(res.statusCode).toBe(404);
  });

  it("BUG: ai-assist serves the SAME secret transcript row 200 to the SAME committee_member — exceeds their clearance ceiling", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/meetings/${MEETING}/ai/transcript`,
      headers: auth(["committee_member"]),
    });
    // /ai/transcript always resolves the meeting's MOST RECENT transcript document — the fixture
    // inserts top_secret then secret, so the secret one is latest; either way a committee_member
    // (max clearance: confidential) is never entitled to read a secret-or-above transcript.
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect([TOP_SECRET_TRANSCRIPT, SECRET_TRANSCRIPT]).toContain(data.documentId);
  });

  it("cleared roles (committee_secretary) still see the transcript via the proper document route — the classification model itself is sound, only the ai-assist path skips it", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/meetings/${MEETING}/documents/${TOP_SECRET_TRANSCRIPT}`,
      headers: auth(["committee_secretary"]),
    });
    expect(res.statusCode).toBe(200);
  });
});
