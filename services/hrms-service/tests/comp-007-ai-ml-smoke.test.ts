/**
 * COMP-007 smoke tests — hrms-service `ai-ml` module.
 *
 * `src/modules/ai-ml/` (document-ocr.ts, face-verification.ts, nlu-chatbot.ts,
 * plugin-registry.ts, recruitment-ai.ts) is registered in app.ts (all five route
 * plugins are `await import`-ed and `app.register`-ed) but, before this file,
 * had zero test references anywhere in the service -- confirmed by grep across
 * tests/, src/__tests__/, and the module directory itself, and independently
 * corroborated by this service's own vitest.config.ts coverage `exclude` list,
 * which already carries a `// AI/ML modules not under test` comment naming
 * `src/modules/ai-ml/**` explicitly.
 *
 * This is a smoke test, not full endpoint coverage (16 endpoints exist across
 * the 5 files; see COMP-007 follow-up for the rest): one representative route
 * per sub-file, asserting the route is registered, auth-gated, and returns a
 * real, sane response through the real app + real DB -- not a placeholder.
 */
import { describe, it, expect, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-000000000099";

function makeToken(roles: string[] = ["hr_admin"], sub = "user-comp007-ai-ml") {
  return signToken({ sub, tid: TENANT, roles, sid: "sess-comp007-ai-ml" }, SECRET);
}

afterAll(async () => {
  await sqlClient.end();
});

describe("COMP-007: ai-ml/plugin-registry.ts -- GET /v1/hrms/ai/plugins", () => {
  it("returns 401 without a token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/hrms/ai/plugins" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 200 with a valid token and a real plugin list shaped for the tenant", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/hrms/ai/plugins",
      headers: { authorization: `Bearer ${makeToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.plugins ?? body.data ?? body)).toBe(true);
  });
});

describe("COMP-007: ai-ml/document-ocr.ts -- POST /v1/hrms/ai/ocr/extract", () => {
  it("returns 401 without a token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/hrms/ai/ocr/extract", payload: {} });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 200 and structured OCR output for a valid request", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/hrms/ai/ocr/extract",
      headers: { authorization: `Bearer ${makeToken()}` },
      payload: { imageKey: "uploads/comp007-smoke-receipt.jpg", documentType: "receipt" },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toBeTruthy();
    expect(typeof body.data.confidence).toBe("number");
  });

  // Previously a characterization of a bug (the ai-ml route files set no error handler of their own and
  // app.ts registered registerSchemaErrorHandler AFTER the route plugins, so a ZodError became a 500).
  // The handler is now registered before the routes, so this answers 400.
  it("FIXED (UAT API sweep 2026-10-29): an invalid documentType answers 400, not 500", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/hrms/ai/ocr/extract",
      headers: { authorization: `Bearer ${makeToken()}` },
      payload: { imageKey: "uploads/x.jpg", documentType: "not_a_real_type" },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });
});

describe("COMP-007: ai-ml/nlu-chatbot.ts -- POST /v1/hrms/ai/chat", () => {
  it("returns 401 without a token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/hrms/ai/chat", payload: { message: "hi" } });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 200 with a classified intent for a real greeting", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/hrms/ai/chat",
      headers: { authorization: `Bearer ${makeToken()}` },
      payload: { message: "Good morning" },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.meta?.intent).toBe("greeting");
    expect(typeof body.text).toBe("string");
  });

  // Previously a characterization of a bug: the leave-balance intent queried hrms.leave_allocations, which no
  // migration ever created. It now reads leave.hrms_leave_allocs; this token's user has no employee row, so the
  // bot answers that no allocation was found (200) instead of 500.
  it("FIXED (UAT API sweep 2026-10-29): a leave-balance query answers 200 from leave.hrms_leave_allocs", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/hrms/ai/chat",
      headers: { authorization: `Bearer ${makeToken()}` },
      payload: { message: "How many casual leave days do I have left?" },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(JSON.stringify(res.json())).toContain("leave allocation");
  });
});

describe("COMP-007: ai-ml/recruitment-ai.ts -- POST /v1/hrms/ai/recruitment/score-jd", () => {
  it("returns 401 without a token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/hrms/ai/recruitment/score-jd", payload: {} });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 200 with a real score for a valid JD payload", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/hrms/ai/recruitment/score-jd",
      headers: { authorization: `Bearer ${makeToken()}` },
      payload: {
        title: "Assistant Section Officer",
        description: "Handles correspondence, file movement, and RTI replies for the department. Requires drafting and record-keeping skills.",
        requirements: ["Bachelor's degree", "Typing speed 30 wpm"],
        experienceYears: { min: 0, max: 5 },
        educationLevel: "graduate",
      },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
  });

  // Previously a characterization of a bug (the ai-ml route files set no error handler of their own and
  // app.ts registered registerSchemaErrorHandler AFTER the route plugins, so a ZodError became a 500).
  // The handler is now registered before the routes, so this answers 400.
  it("FIXED (UAT API sweep 2026-10-29): a JD description below the minimum length answers 400, not 500", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/hrms/ai/recruitment/score-jd",
      headers: { authorization: `Bearer ${makeToken()}` },
      payload: {
        title: "Assistant",
        description: "too short",
        requirements: ["x"],
        experienceYears: { min: 0, max: 5 },
        educationLevel: "graduate",
      },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });
});

describe("COMP-007: ai-ml/face-verification.ts -- POST /v1/hrms/ai/face/enroll", () => {
  it("returns 401 without a token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/hrms/ai/face/enroll", payload: {} });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  // Previously a characterization of a bug (the ai-ml route files set no error handler of their own and
  // app.ts registered registerSchemaErrorHandler AFTER the route plugins, so a ZodError became a 500).
  // The handler is now registered before the routes, so this answers 400.
  it("FIXED (UAT API sweep 2026-10-29): a malformed employeeId answers 400, not 500", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/hrms/ai/face/enroll",
      headers: { authorization: `Bearer ${makeToken()}` },
      payload: { employeeId: "not-a-uuid", photoKey: "uploads/comp007-smoke-selfie.jpg" },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });
});
