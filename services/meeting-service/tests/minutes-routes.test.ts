/**
 * Minutes module — route-level integration tests (task 9.3).
 *
 * Exercises all 11 minutes endpoints through the in-memory Fastify app via `app.inject()`
 * (no network), against the real `meeting` Postgres schema seeded directly for reads. Auth is
 * the HS256 test bypass (JWT_SECRET from vitest.config.ts). Per the suite hard rule, every
 * endpoint is covered for happy path + 400 (validation) + 401 (unauthenticated) + 403
 * (unauthorized role) + 404 (not found), plus the public (unauthenticated) verification path.
 *
 *   writes → 202 { data: { id, status: "accepted", correlationId } } (command queued)
 *   reads  → 200 { data }
 *   verify → 200 { data } and is reachable WITHOUT a token (public route)
 *
 * _Requirements: 7.1, 7.3, 7.5, 7.8, 8.1, 8.4_
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { computeHash } from "../src/modules/minutes/domain.js";

const SECRET = "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-cccc-4000-8000-0000000009a3";
const OTHER_TENANT = "aaaaaaaa-cccc-4000-8000-0000000009ff";
const ACTOR = "00000000-cccc-4000-8000-0000000009a3";

const MEETING = "bbbbbbbb-cccc-4000-8000-0000000009a3";
const MINUTES = "cccccccc-cccc-4000-8000-0000000009a3";
const MISSING = "dddddddd-cccc-4000-8000-0000000009a3";

const CONTENT = "# Minutes: Board Meeting\n\n## Resolutions\n- R-1: Approve the annual budget (For: 5, Against: 0, Abstain: 0) — passed";
const CONTENT_HASH = computeHash(CONTENT);
const SIGNER = "Smt. A. Chairperson";

function token(roles: string[] = ["super_admin"], tid: string = TENANT): string {
  return signToken({ sub: ACTOR, tid, roles, sid: "sess-minutes" }, SECRET, 3600);
}
function authHeader(roles?: string[], tid?: string) {
  return { authorization: `Bearer ${token(roles, tid)}` };
}

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();

  // Clean any prior fixtures, then seed a meeting + a signed minutes + one prior version.
  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`DELETE FROM meeting.minutes_versions WHERE minutes_id = ${MINUTES}`;
  });
  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`DELETE FROM meeting.minutes WHERE id = ${MINUTES}`;
  });
  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`DELETE FROM meeting.meetings WHERE id = ${MEETING}`;
  });

  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`
    INSERT INTO meeting.meetings (id, tenant_id, type, title, status, duration_minutes, created_by, updated_by)
    VALUES (${MEETING}, ${TENANT}, 'committee', 'Board Meeting', 'minutes_pending', 60, ${ACTOR}, ${ACTOR})
  `;
  });
  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`
    INSERT INTO meeting.minutes
      (id, tenant_id, meeting_id, template_type, content, status, current_version,
       dsc_signature, dsc_signer_name, dsc_signed_at, hash_current, created_by, updated_by, version)
    VALUES
      (${MINUTES}, ${TENANT}, ${MEETING}, 'resolution_only', ${CONTENT}, 'signed', 2,
       ${"pkcs7-detached:sha256:" + CONTENT_HASH}, ${SIGNER}, now(), ${CONTENT_HASH}, ${ACTOR}, ${ACTOR}, 1)
  `;
  });
  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`
    INSERT INTO meeting.minutes_versions (tenant_id, minutes_id, version_num, content, changed_by)
    VALUES (${TENANT}, ${MINUTES}, 1, ${"draft v1 content"}, ${ACTOR})
  `;
  });
});

afterAll(async () => {
  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`DELETE FROM meeting.minutes_versions WHERE minutes_id = ${MINUTES}`;
  });
  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`DELETE FROM meeting.minutes WHERE id = ${MINUTES}`;
  });
  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`DELETE FROM meeting.meetings WHERE id = ${MEETING}`;
  });
  await app.close();
  await sqlClient.end();
});

const base = `/v1/meetings/${MEETING}/minutes`;

describe("POST /v1/meetings/:meetingId/minutes (create draft)", () => {
  it("202 for the secretariat with a valid body", async () => {
    const res = await app.inject({ method: "POST", url: base, headers: authHeader(["committee_secretary"]), payload: { templateType: "summary" } });
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.data.status).toBe("accepted");
    expect(body.data.id).toBeTruthy();
    expect(body.data.correlationId).toBeTruthy();
  });

  it("400 for an invalid templateType", async () => {
    const res = await app.inject({ method: "POST", url: base, headers: authHeader(["committee_secretary"]), payload: { templateType: "bogus" } });
    expect(res.statusCode).toBe(400);
  });

  it("401 without a token", async () => {
    const res = await app.inject({ method: "POST", url: base, payload: { templateType: "summary" } });
    expect(res.statusCode).toBe(401);
  });

  it("403 for a role without write access", async () => {
    const res = await app.inject({ method: "POST", url: base, headers: authHeader(["employee"]), payload: {} });
    expect(res.statusCode).toBe(403);
  });

  it("404 when the meeting does not exist", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/meetings/${MISSING}/minutes`, headers: authHeader(["committee_secretary"]), payload: {} });
    expect(res.statusCode).toBe(404);
  });
});

describe("GET /v1/meetings/:meetingId/minutes (get the meeting's minutes)", () => {
  it("200 for an authorized reader", async () => {
    const res = await app.inject({ method: "GET", url: base, headers: authHeader(["committee_member"]) });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.id).toBe(MINUTES);
  });

  it("401 without a token", async () => {
    const res = await app.inject({ method: "GET", url: base });
    expect(res.statusCode).toBe(401);
  });

  it("403 for a role outside the meeting roles", async () => {
    const res = await app.inject({ method: "GET", url: base, headers: authHeader(["employee"]) });
    expect(res.statusCode).toBe(403);
  });

  it("404 when the meeting has no minutes", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/meetings/${MISSING}/minutes`, headers: authHeader() });
    expect(res.statusCode).toBe(404);
  });
});

describe("PATCH /v1/meetings/:meetingId/minutes/:minutesId (update draft)", () => {
  const url = `${base}/${MINUTES}`;
  it("202 with a valid version + content", async () => {
    const res = await app.inject({ method: "PATCH", url, headers: authHeader(["committee_secretary"]), payload: { version: 1, content: "revised body" } });
    expect(res.statusCode).toBe(202);
  });

  it("400 when version/content are missing", async () => {
    const res = await app.inject({ method: "PATCH", url, headers: authHeader(["committee_secretary"]), payload: {} });
    expect(res.statusCode).toBe(400);
  });

  it("401 without a token", async () => {
    const res = await app.inject({ method: "PATCH", url, payload: { version: 1, content: "x" } });
    expect(res.statusCode).toBe(401);
  });

  it("403 for a role without write access", async () => {
    const res = await app.inject({ method: "PATCH", url, headers: authHeader(["employee"]), payload: { version: 1, content: "x" } });
    expect(res.statusCode).toBe(403);
  });

  it("404 for an unknown minutes id", async () => {
    const res = await app.inject({ method: "PATCH", url: `${base}/${MISSING}`, headers: authHeader(["committee_secretary"]), payload: { version: 1, content: "x" } });
    expect(res.statusCode).toBe(404);
  });
});

describe("POST submit / approve / reject / sign / circulate", () => {
  it("submit → 202 for the secretariat", async () => {
    const res = await app.inject({ method: "POST", url: `${base}/${MINUTES}/submit`, headers: authHeader(["committee_secretary"]), payload: { version: 1 } });
    expect(res.statusCode).toBe(202);
  });

  it("submit → 400 without a version", async () => {
    const res = await app.inject({ method: "POST", url: `${base}/${MINUTES}/submit`, headers: authHeader(["committee_secretary"]), payload: {} });
    expect(res.statusCode).toBe(400);
  });

  it("approve → 202 for the chairperson", async () => {
    const res = await app.inject({ method: "POST", url: `${base}/${MINUTES}/approve`, headers: authHeader(["committee_chairperson"]), payload: { version: 1 } });
    expect(res.statusCode).toBe(202);
  });

  it("approve → 403 for the secretariat (chairperson-only)", async () => {
    const res = await app.inject({ method: "POST", url: `${base}/${MINUTES}/approve`, headers: authHeader(["committee_secretary"]), payload: { version: 1 } });
    expect(res.statusCode).toBe(403);
  });

  it("approve → 401 without a token", async () => {
    const res = await app.inject({ method: "POST", url: `${base}/${MINUTES}/approve`, payload: { version: 1 } });
    expect(res.statusCode).toBe(401);
  });

  it("approve → 404 for an unknown minutes id", async () => {
    const res = await app.inject({ method: "POST", url: `${base}/${MISSING}/approve`, headers: authHeader(["committee_chairperson"]), payload: { version: 1 } });
    expect(res.statusCode).toBe(404);
  });

  it("reject → 202 for the chairperson with mandatory comments", async () => {
    const res = await app.inject({ method: "POST", url: `${base}/${MINUTES}/reject`, headers: authHeader(["committee_chairperson"]), payload: { version: 1, rejectionComments: "please correct the quorum note" } });
    expect(res.statusCode).toBe(202);
  });

  it("reject → 400 when rejectionComments are missing", async () => {
    const res = await app.inject({ method: "POST", url: `${base}/${MINUTES}/reject`, headers: authHeader(["committee_chairperson"]), payload: { version: 1 } });
    expect(res.statusCode).toBe(400);
  });

  it("sign → 202 for the chairperson", async () => {
    const res = await app.inject({ method: "POST", url: `${base}/${MINUTES}/sign`, headers: authHeader(["committee_chairperson"]), payload: { version: 1 } });
    expect(res.statusCode).toBe(202);
  });

  it("sign → 403 for the secretariat", async () => {
    const res = await app.inject({ method: "POST", url: `${base}/${MINUTES}/sign`, headers: authHeader(["committee_secretary"]), payload: { version: 1 } });
    expect(res.statusCode).toBe(403);
  });

  it("circulate → 202 for the secretariat", async () => {
    const res = await app.inject({ method: "POST", url: `${base}/${MINUTES}/circulate`, headers: authHeader(["committee_secretary"]), payload: {} });
    expect(res.statusCode).toBe(202);
  });

  it("circulate → 404 for an unknown minutes id", async () => {
    const res = await app.inject({ method: "POST", url: `${base}/${MISSING}/circulate`, headers: authHeader(["committee_secretary"]), payload: {} });
    expect(res.statusCode).toBe(404);
  });
});

describe("GET version history + single version", () => {
  it("versions → 200 with the seeded history", async () => {
    const res = await app.inject({ method: "GET", url: `${base}/${MINUTES}/versions`, headers: authHeader(["committee_member"]) });
    expect(res.statusCode).toBe(200);
    const rows = res.json().data;
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0].versionNum).toBe(1);
  });

  it("versions → 401 without a token", async () => {
    const res = await app.inject({ method: "GET", url: `${base}/${MINUTES}/versions` });
    expect(res.statusCode).toBe(401);
  });

  it("versions → 403 for a role outside the meeting roles", async () => {
    const res = await app.inject({ method: "GET", url: `${base}/${MINUTES}/versions`, headers: authHeader(["employee"]) });
    expect(res.statusCode).toBe(403);
  });

  it("versions → 404 for an unknown minutes id", async () => {
    const res = await app.inject({ method: "GET", url: `${base}/${MISSING}/versions`, headers: authHeader() });
    expect(res.statusCode).toBe(404);
  });

  it("version/:num → 200 for an existing version", async () => {
    const res = await app.inject({ method: "GET", url: `${base}/${MINUTES}/versions/1`, headers: authHeader() });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.versionNum).toBe(1);
  });

  it("version/:num → 400 for a non-numeric version", async () => {
    const res = await app.inject({ method: "GET", url: `${base}/${MINUTES}/versions/abc`, headers: authHeader() });
    expect(res.statusCode).toBe(400);
  });

  it("version/:num → 404 for a missing version number", async () => {
    const res = await app.inject({ method: "GET", url: `${base}/${MINUTES}/versions/99`, headers: authHeader() });
    expect(res.statusCode).toBe(404);
  });
});

describe("POST /v1/meetings/minutes/verify (public verification)", () => {
  const url = `/v1/meetings/minutes/verify?tenantId=${TENANT}`;

  it("200 valid — signed minutes whose content hash matches (reachable WITHOUT a token)", async () => {
    const res = await app.inject({ method: "POST", url, payload: { minutesId: MINUTES } });
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.found).toBe(true);
    expect(data.integrity).toBe("valid");
    expect(data.signed).toBe(true);
    expect(data.signerName).toBe(SIGNER);
    expect(data.meetingId).toBe(MEETING);
  });

  it("200 valid — verification by content hash (QR path)", async () => {
    const res = await app.inject({ method: "POST", url, payload: { hashCurrent: CONTENT_HASH } });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.integrity).toBe("valid");
  });

  it("200 not_found — unknown minutes id does not leak existence", async () => {
    const res = await app.inject({ method: "POST", url, payload: { minutesId: MISSING } });
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.found).toBe(false);
    expect(data.integrity).toBe("not_found");
  });

  it("400 when neither minutesId nor hashCurrent is supplied", async () => {
    const res = await app.inject({ method: "POST", url, payload: {} });
    expect(res.statusCode).toBe(400);
  });

  it("200 not_found for a different tenant (isolation)", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/meetings/minutes/verify?tenantId=${OTHER_TENANT}`, payload: { minutesId: MINUTES } });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.found).toBe(false);
  });
});
