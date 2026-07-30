/**
 * R-RA-0105 — application-copy PDF route. @civitasone/render is mocked to avoid
 * launching Playwright in unit tests.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { signToken } from "@civitasone/auth";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-0105-4000-8000-000000000105";
const USER = "aaaaaaaa-7777-4000-8000-000000000105";
const APP = "dddddddd-0105-4000-8000-00000000d105";
const JOB = "ffffffff-0105-4000-8000-00000000f105";

const H = vi.hoisted(() => ({ findApplication: vi.fn(), getVacancyHeader: vi.fn(), renderPdf: vi.fn() }));

vi.mock("@civitasone/render", () => ({ renderPdf: (...a: unknown[]) => H.renderPdf(...a) }));
vi.mock("../src/modules/recruitment/screening-repo.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  findApplication: (...a: unknown[]) => H.findApplication(...a),
}));
vi.mock("../src/modules/recruitment/application-pdf-repo.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  getVacancyHeader: (...a: unknown[]) => H.getVacancyHeader(...a),
}));

import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const tok = (roles: string[]) => signToken({ sub: USER, tid: TENANT, roles, sid: "s" }, SECRET);
const auth = (roles = ["hr_officer"]) => ({ authorization: `Bearer ${tok(roles)}` });
const appRow = { id: APP, tenantId: TENANT, jobOpeningId: JOB, applicantName: "Asha Rao", applicationNo: "APP-001", category: "GEN", qualification: "B.Tech", experienceYears: 3, status: "shortlisted", appliedAt: new Date("2026-07-01T00:00:00Z") };

beforeEach(() => {
  vi.clearAllMocks();
  H.findApplication.mockResolvedValue(appRow);
  H.getVacancyHeader.mockResolvedValue({ title: "Junior Engineer", refNo: "REF-9" });
  H.renderPdf.mockResolvedValue({ buffer: Buffer.from("%PDF-1.7 fake"), mode: "playwright", signed: false });
});
afterAll(async () => { await sqlClient.end(); });

describe("application-copy PDF (R-RA-0105)", () => {
  it("returns a PDF with attachment disposition (200)", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `/v1/hrms/applications/${APP}/pdf`, headers: auth() });
    expect(r.statusCode).toBe(200);
    expect(r.headers["content-type"]).toContain("application/pdf");
    expect(r.headers["content-disposition"]).toContain('attachment; filename="application_APP-001.pdf"');
    expect(r.headers["x-render-mode"]).toBe("playwright");
    expect(H.renderPdf).toHaveBeenCalledOnce();
    await app.close();
  });

  it("reports text/html honestly when the renderer falls back (chromium unavailable)", async () => {
    H.renderPdf.mockResolvedValue({ buffer: Buffer.from("<html></html>"), mode: "html-only", signed: false });
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `/v1/hrms/applications/${APP}/pdf`, headers: auth() });
    expect(r.statusCode).toBe(200);
    expect(r.headers["content-type"]).toContain("text/html");
    expect(r.headers["content-disposition"]).toContain(".html");
    await app.close();
  });

  it("feeds the candidate's data (escaped) to the renderer", async () => {
    H.findApplication.mockResolvedValue({ ...appRow, applicantName: "<b>x</b>" });
    const app = await buildApp();
    await app.inject({ method: "GET", url: `/v1/hrms/applications/${APP}/pdf`, headers: auth() });
    const html = (H.renderPdf.mock.calls[0][0] as { html: string }).html;
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(html).not.toContain("<b>x</b>");
    await app.close();
  });

  it("404 for a missing application", async () => {
    H.findApplication.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `/v1/hrms/applications/${APP}/pdf`, headers: auth() });
    expect(r.statusCode).toBe(404);
    expect(H.renderPdf).not.toHaveBeenCalled();
    await app.close();
  });

  it("forbids a non-HR role (403)", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `/v1/hrms/applications/${APP}/pdf`, headers: auth(["employee"]) });
    expect(r.statusCode).toBe(403);
    await app.close();
  });

  it("requires auth (401)", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `/v1/hrms/applications/${APP}/pdf` });
    expect(r.statusCode).toBe(401);
    await app.close();
  });
});
