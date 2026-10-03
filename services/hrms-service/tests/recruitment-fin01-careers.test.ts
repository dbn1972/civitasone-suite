/**
 * fin-recruitment-01 public careers contracts:
 *  - GAP-RECRUITMENT-CAREERS-DETAIL-03: self-declared category + date of birth on the apply body
 *  - GAP-RECRUITMENT-CAREERS-DETAIL-04: public resume upload (size/type/magic/scan/abuse limits)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { randomUUID } from "node:crypto";

const TENANT = "aaaaaaaa-0001-4000-8000-00000000a001";
const JOB = "22222222-0001-4000-8000-000000000002";

const H = vi.hoisted(() => ({
  findPublishedOpening: vi.fn(),
  putObject: vi.fn(async () => undefined),
  scan: vi.fn(async () => ({ status: "clean" as "clean" | "infected" | "error" })),
  submit: vi.fn(),
  findByDedup: vi.fn(async () => null),
}));

vi.mock("../src/modules/recruitment/repo.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  findPublishedOpening: (...a: unknown[]) => H.findPublishedOpening(...a),
  findApplicationByDedupKey: (...a: unknown[]) => H.findByDedup(...a),
}));
vi.mock("../src/modules/recruitment/commands.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  submitPublicApplication: (...a: unknown[]) => H.submit(...a),
}));
vi.mock("@civitasone/storage", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  putObject: (...a: unknown[]) => (H.putObject as (...x: unknown[]) => unknown)(...a),
}));
vi.mock("@civitasone/scanner", () => ({ scanBuffer: (...a: unknown[]) => (H.scan as (...x: unknown[]) => unknown)(...a) }));

import { careersResumeRoutes } from "../src/modules/recruitment/careers-resume-routes.js";
import { publicRecruitmentRoutes } from "../src/modules/recruitment/routes.js";
import { validatePublicResume, isPublicResumeKey, scanVerdict, publicResumePrefix } from "../src/modules/recruitment/careers-resume.js";
import { publicApplicationBody } from "../src/modules/recruitment/validators.js";
import { CAREERS_CONSENT_ACCEPTED_VERSIONS } from "@civitasone/schemas";

const PDF = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(2048, 0x20)]);
const OPEN_VACANCY = { id: JOB, tenantId: TENANT, status: "open", isPublished: true, title: "Assistant", eligibility: {} };

beforeEach(() => {
  vi.clearAllMocks();
  H.findPublishedOpening.mockResolvedValue(OPEN_VACANCY);
  H.scan.mockResolvedValue({ status: "clean" });
});

describe("validatePublicResume (pure)", () => {
  it("accepts a PDF of the right type, extension and magic bytes", () => {
    expect(validatePublicResume({ fileName: "cv.PDF", mimeType: "application/pdf", bytes: PDF })).toEqual([]);
  });
  it("rejects a 6 MB file by its REAL size", () => {
    const big = Buffer.concat([Buffer.from("%PDF-"), Buffer.alloc(6 * 1024 * 1024)]);
    expect(validatePublicResume({ fileName: "cv.pdf", mimeType: "application/pdf", bytes: big }).join()).toMatch(/5 MB/);
  });
  it("rejects an .exe renamed to .pdf (magic bytes) and an unsupported MIME type", () => {
    const exe = Buffer.concat([Buffer.from("MZ"), Buffer.alloc(100)]);
    expect(validatePublicResume({ fileName: "cv.pdf", mimeType: "application/pdf", bytes: exe }).join()).toMatch(/does not match/);
    expect(validatePublicResume({ fileName: "setup.exe", mimeType: "application/x-msdownload", bytes: exe }).join()).toMatch(/unsupported file type/);
  });
  it("rejects a mismatching extension and an empty file", () => {
    expect(validatePublicResume({ fileName: "cv.docx", mimeType: "application/pdf", bytes: PDF }).join()).toMatch(/must end in \.pdf/);
    expect(validatePublicResume({ fileName: "cv.pdf", mimeType: "application/pdf", bytes: Buffer.alloc(0) }).join()).toMatch(/empty/);
  });
});

describe("isPublicResumeKey / scanVerdict", () => {
  const key = `${publicResumePrefix(TENANT)}${randomUUID()}.pdf`;
  it("accepts only a key this service issues for the same tenant", () => {
    expect(isPublicResumeKey(key, TENANT)).toBe(true);
    expect(isPublicResumeKey(key, "bbbbbbbb-0001-4000-8000-00000000b001")).toBe(false);
    expect(isPublicResumeKey(`${publicResumePrefix(TENANT)}../../etc/passwd`, TENANT)).toBe(false);
    expect(isPublicResumeKey(`candidates/x/resumes/${randomUUID()}.pdf`, TENANT)).toBe(false);
  });
  it("never accepts an infected file; an unavailable scanner is fail-closed in production", () => {
    expect(scanVerdict("clean", {})).toBe("accept");
    expect(scanVerdict("infected", {})).toBe("infected");
    expect(scanVerdict("error", { NODE_ENV: "production" })).toBe("unavailable");
    expect(scanVerdict("error", { NODE_ENV: "production", CAREERS_RESUME_SCAN_OPTIONAL: "true" })).toBe("accept");
    expect(scanVerdict("error", { NODE_ENV: "development" })).toBe("accept");
  });
});

describe("POST /v1/careers/resume", () => {
  const payload = (over: Record<string, unknown> = {}) => ({
    tenantId: TENANT, jobOpeningId: JOB, fileName: "cv.pdf", mimeType: "application/pdf", contentBase64: PDF.toString("base64"), ...over,
  });
  async function app() { const a = Fastify(); await a.register(careersResumeRoutes); return a; }

  it("stores a clean PDF under the tenant's careers-resumes namespace and returns the key", async () => {
    const a = await app();
    const res = await a.inject({ method: "POST", url: "/v1/careers/resume", payload: payload() });
    expect(res.statusCode).toBe(201);
    const { resumeKey, sizeBytes } = res.json();
    expect(isPublicResumeKey(resumeKey, TENANT)).toBe(true);
    expect(sizeBytes).toBe(PDF.length);
    expect(H.putObject).toHaveBeenCalledWith(resumeKey, expect.any(Buffer), "application/pdf");
    await a.close();
  });

  it("rejects a 6 MB file, a renamed .exe and a virus-scan hit, and stores nothing", async () => {
    const a = await app();
    // just over the 5 MB cap: inside the transport limit, so the content rule rejects it...
    const justOver = Buffer.concat([Buffer.from("%PDF-"), Buffer.alloc(5 * 1024 * 1024 + 1000)]).toString("base64");
    expect((await a.inject({ method: "POST", url: "/v1/careers/resume", payload: payload({ contentBase64: justOver }) })).statusCode).toBe(422);
    // ...and a 6 MB file never gets past the transport body limit.
    const big = Buffer.concat([Buffer.from("%PDF-"), Buffer.alloc(6 * 1024 * 1024)]).toString("base64");
    expect((await a.inject({ method: "POST", url: "/v1/careers/resume", payload: payload({ contentBase64: big }) })).statusCode).toBe(413);
    const exe = Buffer.concat([Buffer.from("MZ"), Buffer.alloc(100)]).toString("base64");
    expect((await a.inject({ method: "POST", url: "/v1/careers/resume", payload: payload({ contentBase64: exe }) })).statusCode).toBe(422);
    H.scan.mockResolvedValueOnce({ status: "infected" });
    const infected = await a.inject({ method: "POST", url: "/v1/careers/resume", payload: payload() });
    expect(infected.statusCode).toBe(422);
    expect(infected.json().code).toBe("MALWARE_DETECTED");
    expect(H.putObject).not.toHaveBeenCalled();
    await a.close();
  });

  it("404s a vacancy that is not published and open (no anonymous writes under random ids)", async () => {
    H.findPublishedOpening.mockResolvedValue(null);
    const a = await app();
    const res = await a.inject({ method: "POST", url: "/v1/careers/resume", payload: payload() });
    expect(res.statusCode).toBe(404);
    expect(H.putObject).not.toHaveBeenCalled();
    await a.close();
  });

  it("is fail-closed in production when the scanner is unavailable", async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    H.scan.mockResolvedValueOnce({ status: "error" });
    try {
      const a = await app();
      const res = await a.inject({ method: "POST", url: "/v1/careers/resume", payload: payload() });
      expect(res.statusCode).toBe(503);
      expect(res.json().code).toBe("SCAN_UNAVAILABLE");
      expect(H.putObject).not.toHaveBeenCalled();
      await a.close();
    } finally { process.env.NODE_ENV = prev; }
  });
});

describe("public apply body: category + date of birth", () => {
  const base = {
    jobOpeningId: JOB, applicantName: "Asha Verma", email: "asha@example.com",
    consent: true as const, consentVersion: CAREERS_CONSENT_ACCEPTED_VERSIONS[0]!,
  };
  it("normalises the category to lower case so the HR card's compare matches (SC -> sc)", () => {
    expect(publicApplicationBody.parse({ ...base, category: "SC" }).category).toBe("sc");
    expect(publicApplicationBody.parse({ ...base, category: " Obc " }).category).toBe("obc");
  });
  it("rejects an unknown category, a future date of birth and an impossible date", () => {
    expect(publicApplicationBody.safeParse({ ...base, category: "PH" }).success).toBe(false);
    const future = new Date(Date.now() + 86_400_000 * 400).toISOString().slice(0, 10);
    expect(publicApplicationBody.safeParse({ ...base, dateOfBirth: future }).success).toBe(false);
    expect(publicApplicationBody.safeParse({ ...base, dateOfBirth: "1990-02-31" }).success).toBe(false);
    expect(publicApplicationBody.safeParse({ ...base, dateOfBirth: "1990-05-17" }).success).toBe(true);
  });

  it("POST /v1/careers/apply stores the category, and refuses a resume key issued for another tenant", async () => {
    H.submit.mockResolvedValue({ id: "a1", applicationNo: "APP-2026-0001", status: "received", alreadyApplied: false });
    const a = Fastify();
    await a.register(publicRecruitmentRoutes);
    const goodKey = `${publicResumePrefix(TENANT)}${randomUUID()}.pdf`;
    const ok = await a.inject({ method: "POST", url: "/v1/careers/apply", payload: { ...base, tenantId: TENANT, category: "SC", dateOfBirth: "1995-03-04", resumeKey: goodKey } });
    expect(ok.statusCode).toBe(202);
    const body = H.submit.mock.calls[0]![1] as { category: string; dateOfBirth: string; resumeKey: string };
    expect(body).toMatchObject({ category: "sc", dateOfBirth: "1995-03-04", resumeKey: goodKey });
    H.submit.mockClear();
    const foreign = await a.inject({ method: "POST", url: "/v1/careers/apply", payload: { ...base, tenantId: TENANT, resumeKey: `${publicResumePrefix("bbbbbbbb-0001-4000-8000-00000000b001")}${randomUUID()}.pdf` } });
    expect(foreign.statusCode).toBe(422);
    expect(foreign.json().code).toBe("INVALID_RESUME");
    expect(H.submit).not.toHaveBeenCalled();
    await a.close();
  });
});
