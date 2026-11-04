/**
 * PR #2463 review: GET /v1/meetings/:meetingId/minutes/pdf route tests (real DB, real Chromium).
 * Names, not ids; Markdown rendered; IST; 404 / 401 / 403 / 400 paths.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { signToken } from "@civitasone/auth";
import { closePdfRenderer } from "@civitasone/render";
import { pdfFlatText, pdfjsPageLines } from "@civitasone/render/testing";

// The meeting suite renders minutes in html-only mode for its storage consumer tests; the
// issued minutes PDF is real Chromium output, so this file uses the real renderer.
const savedMode = process.env.RENDER_PDF_MODE;
process.env.RENDER_PDF_MODE = "playwright";

const { buildApp } = await import("../src/app.js");
const { sqlClient } = await import("../src/shared/db.js");

const SECRET = "test_secret_for_civitasone_32chr";
const T = "aaaaaaaa-cccc-4000-8000-0000000d0c71";
const OTHER_T = "aaaaaaaa-cccc-4000-8000-0000000d0c72";
const CHAIR = "00000000-cccc-4000-8000-0000000d0c71";
const SECY = "00000000-cccc-4000-8000-0000000d0c72";
const MEETING = "bbbbbbbb-cccc-4000-8000-0000000d0c71";
const EMPTY_MEETING = "bbbbbbbb-cccc-4000-8000-0000000d0c72";
const MINUTES = "cccccccc-cccc-4000-8000-0000000d0c71";
const tok = (roles: string[] = ["committee_member"], tid = T) => ({ authorization: `Bearer ${signToken({ sub: SECY, tid, roles, sid: "s-minpdf" }, SECRET, 3600)}` });
let app: FastifyInstance;
const realFetch = globalThis.fetch;

async function inTenant(fn: (sql: typeof sqlClient) => Promise<unknown>) {
  await sqlClient.begin(async (sql) => { await sql`select set_config('app.tenant_id', ${T}, true)`; await fn(sql as unknown as typeof sqlClient); });
}
async function wipe() {
  await inTenant((sql) => sql`DELETE FROM meeting.minutes WHERE id = ${MINUTES}`);
  await inTenant((sql) => sql`DELETE FROM meeting.meetings WHERE id IN (${MEETING}, ${EMPTY_MEETING})`);
}

beforeAll(async () => {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (String(url).includes("/employee-summaries")) {
      return new Response(JSON.stringify([
        { fullName: "Asha Rao", designationName: "Joint Secretary", userRef: CHAIR },
        { fullName: "Meena Iyer", designationName: "Section Officer", userRef: SECY },
      ]), { status: 200 });
    }
    if (String(url).includes("/v1/tenants/") || String(url).includes("/user-summaries")) return new Response("[]", { status: 200 });
    return realFetch(url);
  }));
  app = await buildApp();
  await wipe();
  await inTenant((sql) => sql`
    INSERT INTO meeting.meetings (id, tenant_id, type, title, status, duration_minutes, chairperson_id, secretary_id, scheduled_at, venue, meeting_number, created_by, updated_by)
    VALUES (${MEETING}, ${T}, 'committee', 'Purchase committee', 'minutes_pending', 60, ${CHAIR}, ${SECY}, '2026-11-19T16:48:00Z', 'Committee Room 2', 'MTG/2026-27/927', ${SECY}, ${SECY}),
           (${EMPTY_MEETING}, ${T}, 'committee', 'No minutes yet', 'minutes_pending', 60, ${CHAIR}, ${SECY}, null, null, null, ${SECY}, ${SECY})`);
  await inTenant((sql) => sql`
    INSERT INTO meeting.minutes (id, tenant_id, meeting_id, template_type, content, status, current_version, approved_by, approved_at, created_by, updated_by, version)
    VALUES (${MINUTES}, ${T}, ${MEETING}, 'summary', ${"# Minutes\n\n## Decisions\n1. **Approved** the purchase."}, 'approved', 1, ${CHAIR}, '2026-11-20T05:00:00Z', ${SECY}, ${SECY}, 1)`);
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await wipe();
  await app.close();
  await closePdfRenderer();
  await sqlClient.end();
  if (savedMode === undefined) delete process.env.RENDER_PDF_MODE; else process.env.RENDER_PDF_MODE = savedMode;
});

describe("GET /v1/meetings/:meetingId/minutes/pdf", () => {
  it("200 application/pdf with names and designations, rendered Markdown, IST; no ids", async () => {
    const r = await app.inject({ method: "GET", url: `/v1/meetings/${MEETING}/minutes/pdf`, headers: tok() });
    expect(r.statusCode, r.body.slice(0, 200)).toBe(200);
    expect(r.headers["content-type"]).toBe("application/pdf");
    const text = await pdfFlatText(r.rawPayload);
    expect(text).toContain("No. MTG/2026-27/927");
    expect(text).toContain("Chairperson Asha Rao, Joint Secretary");
    expect(text).toContain("19 Nov 2026, 10:18 PM IST");
    expect(text).toContain("1. Approved the purchase.");
    expect(text).not.toMatch(/\*\*|^#/m);
    expect(text).not.toContain(CHAIR);
    expect((await pdfjsPageLines(r.rawPayload)).flat().join("")).not.toContain("DRAFT");
  }, 60_000);
  it("404 MINUTES_NOT_FOUND / MEETING_NOT_FOUND, 404 for another tenant", async () => {
    const a = await app.inject({ method: "GET", url: `/v1/meetings/${EMPTY_MEETING}/minutes/pdf`, headers: tok() });
    expect(a.statusCode).toBe(404);
    expect(a.json().code).toBe("MINUTES_NOT_FOUND");
    const b = await app.inject({ method: "GET", url: `/v1/meetings/bbbbbbbb-cccc-4000-8000-0000000d0c79/minutes/pdf`, headers: tok() });
    expect(b.json().code).toBe("MEETING_NOT_FOUND");
    expect((await app.inject({ method: "GET", url: `/v1/meetings/${MEETING}/minutes/pdf`, headers: tok(["committee_member"], OTHER_T) })).statusCode).toBe(404);
  });
  it("401 without a token, 403 for a role outside the meeting readers, 400 for a bad id", async () => {
    expect((await app.inject({ method: "GET", url: `/v1/meetings/${MEETING}/minutes/pdf` })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: `/v1/meetings/${MEETING}/minutes/pdf`, headers: tok(["citizen"]) })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: "/v1/meetings/not-a-uuid/minutes/pdf", headers: tok() })).statusCode).toBe(400);
  });
});
