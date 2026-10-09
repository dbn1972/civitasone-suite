/**
 * GAP2-PLATFORM-HRMS-AIML-01 / -02 — authz + biometric-audit regression
 * tests (real DB, no mocks).
 *
 * Before the fix, every route in the hrms `ai-ml` module authenticated with
 * resolveContext() but called NO requireRole — so any authenticated user of
 * any role could enroll/overwrite ANY employee's biometric face embedding
 * (-01, HIGH, DPDP-sensitive), run a live face match against anyone, or run
 * the recruitment-AI shortlist/screen routes that drive hire decisions (-02).
 *
 * These assert a non-privileged authenticated caller is rejected with 403
 * (NOT a 2xx / NOT the pre-fix fall-through to the handler) and that a
 * biometric enroll leaves an audit row naming the actor and the TARGET
 * employee. They FAIL on the old code (which 500s/201s past the missing gate)
 * and PASS after the requireRole gates + the in-transaction audit emit.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { withRawTenantGuc } from "@civitasone/db";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const ACTOR = randomUUID();
const EMP = randomUUID();

function auth(roles: string[]): { authorization: string } {
  const jwt = signToken({ sub: ACTOR, tid: TENANT, roles, sid: "sess-aiml-authz" }, SECRET, 3600);
  return { authorization: `Bearer ${jwt}` };
}

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
});

afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

describe("GAP2-PLATFORM-HRMS-AIML-01: face/enroll + face/verify authz", () => {
  it("rejects a plain employee enrolling a face with 403 (not 201)", async () => {
    const r = await app.inject({
      method: "POST", url: "/v1/hrms/ai/face/enroll",
      headers: auth(["employee"]),
      payload: { employeeId: EMP, photoKey: "uploads/aiml-authz-enroll.jpg" },
    });
    expect(r.statusCode).toBe(403);
  });

  it("rejects a plain employee verifying a face with 403", async () => {
    const r = await app.inject({
      method: "POST", url: "/v1/hrms/ai/face/verify",
      headers: auth(["employee"]),
      payload: { employeeId: EMP, selfieKey: "uploads/aiml-authz-selfie.jpg" },
    });
    expect(r.statusCode).toBe(403);
  });

  it("rejects a plain employee reading enrollment status with 403", async () => {
    const r = await app.inject({
      method: "GET", url: `/v1/hrms/ai/face/status/${EMP}`,
      headers: auth(["employee"]),
    });
    expect(r.statusCode).toBe(403);
  });

  it("allows hr_admin to enroll (201) AND writes an audit row naming the actor + target employee", async () => {
    const r = await app.inject({
      method: "POST", url: "/v1/hrms/ai/face/enroll",
      headers: auth(["hr_admin"]),
      payload: { employeeId: EMP, photoKey: "uploads/aiml-authz-enroll-ok.jpg" },
    });
    expect(r.statusCode).toBe(201);

    const rows = await withRawTenantGuc(sqlClient, TENANT, (tx) => tx`
      SELECT actor_id, action, resource_type, resource_id
      FROM employee.hrms_audit_log
      WHERE tenant_id = ${TENANT} AND action = 'face_enroll' AND resource_id = ${EMP}
    `);
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0]!.actor_id).toBe(ACTOR);
    expect(rows[0]!.resource_id).toBe(EMP);
  });

  it("allows hr_admin to verify an enrolled face (200) AND writes a face_verify audit row", async () => {
    const r = await app.inject({
      method: "POST", url: "/v1/hrms/ai/face/verify",
      headers: auth(["hr_admin"]),
      payload: { employeeId: EMP, selfieKey: "uploads/aiml-authz-selfie-ok.jpg" },
    });
    expect(r.statusCode).toBe(200);

    const rows = await withRawTenantGuc(sqlClient, TENANT, (tx) => tx`
      SELECT actor_id, action, resource_type, resource_id
      FROM employee.hrms_audit_log
      WHERE tenant_id = ${TENANT} AND action = 'face_verify' AND resource_id = ${EMP}
    `);
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0]!.actor_id).toBe(ACTOR);
  });
});

describe("GAP2-PLATFORM-HRMS-AIML-02: recruitment-ai / ocr / chat authz", () => {
  it("rejects a non-recruiter authenticated caller to batch-screen with 403", async () => {
    const r = await app.inject({
      method: "POST", url: "/v1/hrms/ai/recruitment/batch-screen",
      headers: auth(["employee"]),
      payload: { vacancyId: randomUUID(), candidateIds: [randomUUID()] },
    });
    expect(r.statusCode).toBe(403);
  });

  it("rejects a non-recruiter from score-jd / parse-resume / interview-questions / interview-summary", async () => {
    const paths: [string, Record<string, unknown>][] = [
      ["/v1/hrms/ai/recruitment/score-jd", { title: "Officer role", description: "x".repeat(60), requirements: ["a"], experienceYears: { min: 0, max: 5 }, educationLevel: "graduate" }],
      ["/v1/hrms/ai/recruitment/parse-resume", { resumeKey: "r.pdf" }],
      ["/v1/hrms/ai/recruitment/interview-questions", { vacancyId: randomUUID(), candidateId: randomUUID() }],
      ["/v1/hrms/ai/recruitment/interview-summary", { candidateId: randomUUID(), vacancyId: randomUUID(), interviewNotes: "notes long enough to pass validation" }],
    ];
    for (const [url, payload] of paths) {
      const r = await app.inject({ method: "POST", url, headers: auth(["employee"]), payload });
      expect(r.statusCode, `${url} should 403 for a plain employee`).toBe(403);
    }
  });

  it("still allows an authenticated staff member on the self-service ocr + chat routes", async () => {
    const ocr = await app.inject({
      method: "POST", url: "/v1/hrms/ai/ocr/extract",
      headers: auth(["employee"]),
      payload: { imageKey: "uploads/aiml-ocr.jpg", documentType: "receipt" },
    });
    expect(ocr.statusCode).toBe(200);

    const chat = await app.inject({
      method: "POST", url: "/v1/hrms/ai/chat",
      headers: auth(["employee"]),
      payload: { message: "Good morning" },
    });
    expect(chat.statusCode).toBe(200);
  });

  it("allows hr_admin on batch-screen / interview-questions / parse-resume with a real vacancy (200, not 404/500)", async () => {
    const vacancyId = randomUUID();
    await withRawTenantGuc(sqlClient, TENANT, (tx) => tx`
      INSERT INTO recruitment.hrms_job_openings
        (id, tenant_id, ref_no, title, department_id, description, qualification_required,
         min_experience_years, max_experience_years, created_by, updated_by)
      VALUES (${vacancyId}, ${TENANT}, ${"AIML-" + vacancyId.slice(0, 8)}, 'Section Officer',
              ${randomUUID()}, 'Section officer role', 'Typing; Office administration',
              1, 8, ${ACTOR}, ${ACTOR})
    `);
    const candidateId = randomUUID();
    const headers = auth(["hr_admin"]);

    const batch = await app.inject({
      method: "POST", url: "/v1/hrms/ai/recruitment/batch-screen", headers,
      payload: { vacancyId, candidateIds: [candidateId] },
    });
    expect(batch.statusCode).toBe(200);

    const iq = await app.inject({
      method: "POST", url: "/v1/hrms/ai/recruitment/interview-questions", headers,
      payload: { vacancyId, candidateId },
    });
    expect(iq.statusCode).toBe(200);

    const parse = await app.inject({
      method: "POST", url: "/v1/hrms/ai/recruitment/parse-resume", headers,
      payload: { resumeKey: "uploads/aiml-resume.pdf", vacancyId },
    });
    expect(parse.statusCode).toBe(200);
    expect(parse.json().data).toBeTruthy();
  });

  it("returns an explicit 404 (not 500) for an unknown vacancy", async () => {
    const r = await app.inject({
      method: "POST", url: "/v1/hrms/ai/recruitment/batch-screen",
      headers: auth(["hr_admin"]),
      payload: { vacancyId: randomUUID(), candidateIds: [randomUUID()] },
    });
    expect(r.statusCode).toBe(404);
  });

  it("rejects an unauthenticated caller to ocr/extract and chat with 401", async () => {
    const ocr = await app.inject({ method: "POST", url: "/v1/hrms/ai/ocr/extract", payload: {} });
    expect(ocr.statusCode).toBe(401);
    const chat = await app.inject({ method: "POST", url: "/v1/hrms/ai/chat", payload: { message: "hi" } });
    expect(chat.statusCode).toBe(401);
  });
});
