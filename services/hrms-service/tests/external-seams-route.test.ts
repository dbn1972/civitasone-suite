/**
 * 2C external seams routes — X02 AI, X03 Proctoring, X05 eSign.
 * All return 501 with source:"stub" when not enabled (honest, no fake).
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { signToken } from "@civitasone/auth";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-2c00-4000-8000-0000000002c0";
const USER = "aaaaaaaa-7777-4000-8000-0000000002c0";

vi.mock("../src/shared/db.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  db: { transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb({}) },
}));

import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const tok = (roles: string[]) => signToken({ sub: USER, tid: TENANT, roles, sid: "s" }, SECRET);
const auth = (roles = ["hr_admin"]) => ({ authorization: `Bearer ${tok(roles)}` });

beforeEach(() => {
  delete process.env.FEATURE_RECRUITMENT_AI_ENABLED;
  delete process.env.FEATURE_PROCTORING_ENABLED;
  delete process.env.FEATURE_ESIGN_ENABLED;
});
afterAll(async () => { await sqlClient.end(); });

describe("2C external seams (X02 AI / X03 Proctoring / X05 eSign)", () => {
  // X02 AI
  it("AI parse-resume 501 with source=stub when off", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/recruitment/ai/parse-resume", headers: auth(), payload: { fileKey: "k" } });
    expect(r.statusCode).toBe(501);
    expect(r.json()).toMatchObject({ code: "AI_NOT_ENABLED", source: "stub" });
    await app.close();
  });

  it("AI jd-match 501 when off", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/recruitment/ai/jd-match", headers: auth(), payload: { applicationId: "00000000-0000-4000-8000-000000000001", jobOpeningId: "00000000-0000-4000-8000-000000000002" } });
    expect(r.statusCode).toBe(501);
    await app.close();
  });

  it("AI generate-questions 501 when off", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/recruitment/ai/generate-questions", headers: auth(), payload: { jobOpeningId: "00000000-0000-4000-8000-000000000002" } });
    expect(r.statusCode).toBe(501);
    await app.close();
  });

  it("AI parse-resume returns stub result when flag on", async () => {
    process.env.FEATURE_RECRUITMENT_AI_ENABLED = "true";
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/recruitment/ai/parse-resume", headers: auth(), payload: { fileKey: "k" } });
    expect(r.statusCode).toBe(200);
    expect(r.json().data.source).toBe("stub");
    await app.close();
  });

  // X03 Proctoring
  it("Proctoring start 501 when off", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/recruitment/proctoring/start", headers: auth(), payload: { interviewId: "00000000-0000-4000-8000-000000000001", candidateId: "00000000-0000-4000-8000-000000000002" } });
    expect(r.statusCode).toBe(501);
    expect(r.json()).toMatchObject({ code: "PROCTORING_NOT_ENABLED", source: "stub" });
    await app.close();
  });

  it("Proctoring end 501 when off", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/recruitment/proctoring/end", headers: auth(), payload: { sessionId: "x" } });
    expect(r.statusCode).toBe(501);
    await app.close();
  });

  // X05 eSign
  it("eSign 501 when off", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/recruitment/esign", headers: auth(), payload: { documentKey: "d", signerRole: "panel_chair" } });
    expect(r.statusCode).toBe(501);
    expect(r.json()).toMatchObject({ code: "ESIGN_NOT_ENABLED", source: "stub" });
    await app.close();
  });

  // RBAC
  it("non-admin cannot proctoring/esign (403)", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/recruitment/proctoring/start", headers: auth(["hr_officer"]), payload: { interviewId: "00000000-0000-4000-8000-000000000001", candidateId: "00000000-0000-4000-8000-000000000002" } });
    expect(r.statusCode).toBe(403);
    await app.close();
  });

  it("unauthenticated 401", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/recruitment/ai/parse-resume", payload: { fileKey: "k" } });
    expect(r.statusCode).toBe(401);
    await app.close();
  });
});
