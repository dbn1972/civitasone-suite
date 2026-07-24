/**
 * SVC-122 learning catalogue — integration tests through the real Fastify app.
 * Covers course creation/publish, module→lesson structure, prerequisites, the
 * prerequisite enrolment gate, lesson progress → % complete + resume point +
 * status transitions, and my-learning.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const HR  = "e2222222-0000-4000-8000-000000000001";
const EMP = "e3333333-0000-4000-8000-0000000000e1";
const uniq = Date.now().toString(36);

function tok(actor: string) {
  return signToken({ sub: actor, tid: TENANT, roles: ["super_admin", "hr_admin"], sid: "s" }, SECRET, 3600);
}
const auth = (t: string) => ({ authorization: `Bearer ${t}`, "content-type": "application/json" });
const bare = (t: string) => ({ authorization: `Bearer ${t}` });

let app: FastifyInstance;
let prereqCourseId: string;
let courseId: string;
let moduleId: string;
let l1: string;
let l2: string;

beforeAll(async () => { app = await buildApp(); });
afterAll(async () => { await app.close(); await sqlClient.end(); });

describe("catalogue authoring", () => {
  it("creates and publishes a prerequisite course", async () => {
    let res = await app.inject({ method: "POST", url: "/v1/hrms/learning/courses", headers: auth(tok(HR)),
      payload: { code: `PRE-${uniq}`, title: "Induction", creditHours: 2 } });
    expect(res.statusCode).toBe(201);
    prereqCourseId = res.json().id;
    res = await app.inject({ method: "POST", url: `/v1/hrms/learning/courses/${prereqCourseId}/publish`, headers: bare(tok(HR)) });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("published");
  });

  it("creates a main course with a module, two lessons, and a prerequisite", async () => {
    let res = await app.inject({ method: "POST", url: "/v1/hrms/learning/courses", headers: auth(tok(HR)),
      payload: { code: `MAIN-${uniq}`, title: "Advanced Governance", category: "governance", creditHours: 8 } });
    expect(res.statusCode).toBe(201);
    courseId = res.json().id;

    res = await app.inject({ method: "POST", url: `/v1/hrms/learning/courses/${courseId}/modules`, headers: auth(tok(HR)),
      payload: { title: "Module 1", sequence: 1 } });
    expect(res.statusCode).toBe(201);
    moduleId = res.json().id;

    res = await app.inject({ method: "POST", url: `/v1/hrms/learning/modules/${moduleId}/lessons`, headers: auth(tok(HR)),
      payload: { title: "Lesson 1", sequence: 1, contentType: "video", contentUri: "https://cdn/x.mp4", durationMins: 15 } });
    expect(res.statusCode).toBe(201);
    l1 = res.json().id;
    res = await app.inject({ method: "POST", url: `/v1/hrms/learning/modules/${moduleId}/lessons`, headers: auth(tok(HR)),
      payload: { title: "Lesson 2", sequence: 2, contentType: "pdf", contentUri: "https://cdn/x.pdf" } });
    expect(res.statusCode).toBe(201);
    l2 = res.json().id;

    res = await app.inject({ method: "POST", url: `/v1/hrms/learning/courses/${courseId}/prerequisites`, headers: auth(tok(HR)),
      payload: { prerequisiteCourseId: prereqCourseId } });
    expect(res.statusCode).toBe(201);

    res = await app.inject({ method: "POST", url: `/v1/hrms/learning/courses/${courseId}/publish`, headers: bare(tok(HR)) });
    expect(res.statusCode).toBe(200);
  });

  it("rejects a self-prerequisite", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/hrms/learning/courses/${courseId}/prerequisites`, headers: auth(tok(HR)),
      payload: { prerequisiteCourseId: courseId } });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("INVALID_PREREQ");
  });

  it("catalogue browse/search returns the course by category", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/hrms/learning/courses?q=governance", headers: bare(tok(HR)) });
    expect(res.statusCode).toBe(200);
    expect(res.json().some((c: any) => c.id === courseId)).toBe(true);
  });

  it("course detail includes modules, lessons and prerequisites", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/hrms/learning/courses/${courseId}`, headers: bare(tok(HR)) });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.modules.length).toBe(1);
    expect(body.lessons.length).toBe(2);
    expect(body.prerequisites).toContain(prereqCourseId);
  });
});

describe("enrolment + progress", () => {
  it("blocks enrolment when a prerequisite is not completed", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/hrms/learning/courses/${courseId}/enroll`, headers: auth(tok(HR)),
      payload: { employeeId: EMP } });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("PREREQUISITES_NOT_MET");
    expect(res.json().missing).toContain(prereqCourseId);
  });

  it("completing the prerequisite unblocks enrolment and tracks progress", async () => {
    // Give the prerequisite a lesson, enrol the employee, and complete it so
    // the prerequisite gate on the main course is satisfied.
    let res = await app.inject({ method: "POST", url: `/v1/hrms/learning/courses/${prereqCourseId}/modules`, headers: auth(tok(HR)),
      payload: { title: "M", sequence: 1 } });
    const preMod = res.json().id;
    res = await app.inject({ method: "POST", url: `/v1/hrms/learning/modules/${preMod}/lessons`, headers: auth(tok(HR)),
      payload: { title: "Only", sequence: 1, contentType: "link" } });
    const preLesson = res.json().id;
    res = await app.inject({ method: "POST", url: `/v1/hrms/learning/courses/${prereqCourseId}/enroll`, headers: auth(tok(HR)),
      payload: { employeeId: EMP } });
    expect(res.statusCode).toBe(201);
    res = await app.inject({ method: "POST", url: `/v1/hrms/learning/lessons/${preLesson}/progress`, headers: auth(tok(HR)),
      payload: { employeeId: EMP, status: "completed" } });
    expect(res.statusCode).toBe(200);
    expect(res.json().progressPct).toBe(100);
    expect(res.json().status).toBe("completed");

    // Now enrolment into the main course is allowed.
    res = await app.inject({ method: "POST", url: `/v1/hrms/learning/courses/${courseId}/enroll`, headers: auth(tok(HR)),
      payload: { employeeId: EMP } });
    expect(res.statusCode).toBe(201);
  });

  it("progress updates percent, resume point and status", async () => {
    // Complete lesson 1 of 2 => 50%, in_progress, resume = lesson 2.
    let res = await app.inject({ method: "POST", url: `/v1/hrms/learning/lessons/${l1}/progress`, headers: auth(tok(HR)),
      payload: { employeeId: EMP, status: "completed" } });
    expect(res.statusCode).toBe(200);
    expect(res.json().progressPct).toBe(50);
    expect(res.json().status).toBe("in_progress");
    expect(res.json().resumeLessonId).toBe(l2);

    // Complete lesson 2 => 100%, completed, resume = null.
    res = await app.inject({ method: "POST", url: `/v1/hrms/learning/lessons/${l2}/progress`, headers: auth(tok(HR)),
      payload: { employeeId: EMP, status: "completed" } });
    expect(res.json().progressPct).toBe(100);
    expect(res.json().status).toBe("completed");
    expect(res.json().resumeLessonId).toBeNull();
  });

  it("my-learning lists the employee's enrolments with progress", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/hrms/learning/my-learning?employeeId=${EMP}`, headers: bare(tok(HR)) });
    expect(res.statusCode).toBe(200);
    const rows = res.json();
    const main = rows.find((r: any) => r.courseId === courseId);
    expect(main.progressPct).toBe(100);
    expect(main.courseTitle).toBe("Advanced Governance");
  });

  it("progress on a course the employee is not enrolled in is rejected", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/hrms/learning/lessons/${l1}/progress`, headers: auth(tok(HR)),
      payload: { employeeId: "e4444444-0000-4000-8000-0000000000f9", status: "completed" } });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("NOT_ENROLLED");
  });

  it("re-enrolment is idempotent (200 with existing enrolment)", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/hrms/learning/courses/${courseId}/enroll`, headers: auth(tok(HR)),
      payload: { employeeId: EMP } });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("completed");
  });
});

describe("route guards", () => {
  it("404s course detail for a missing course", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/hrms/learning/courses/${randomUUID()}`, headers: bare(tok(HR)) });
    expect(res.statusCode).toBe(404);
  });
  it("404s adding a module to a missing course", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/hrms/learning/courses/${randomUUID()}/modules`, headers: auth(tok(HR)),
      payload: { title: "M" } });
    expect(res.statusCode).toBe(404);
  });
  it("404s adding a lesson to a missing module", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/hrms/learning/modules/${randomUUID()}/lessons`, headers: auth(tok(HR)),
      payload: { title: "L", contentType: "link" } });
    expect(res.statusCode).toBe(404);
  });
  it("409s enrolment in an unpublished (draft) course", async () => {
    let res = await app.inject({ method: "POST", url: "/v1/hrms/learning/courses", headers: auth(tok(HR)),
      payload: { code: `DRAFT-${uniq}`, title: "Draft" } });
    const draftId = res.json().id;
    res = await app.inject({ method: "POST", url: `/v1/hrms/learning/courses/${draftId}/enroll`, headers: auth(tok(HR)),
      payload: { employeeId: EMP } });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("NOT_PUBLISHED");
  });
  it("409s publishing an already-published course", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/hrms/learning/courses/${courseId}/publish`, headers: bare(tok(HR)) });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("INVALID_STATE");
  });
  it("404s a prerequisite referencing a missing course", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/hrms/learning/courses/${courseId}/prerequisites`, headers: auth(tok(HR)),
      payload: { prerequisiteCourseId: randomUUID() } });
    expect(res.statusCode).toBe(404);
  });
});
