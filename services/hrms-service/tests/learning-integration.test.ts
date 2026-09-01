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
import { db, sqlClient } from "../src/shared/db.js";
import { tenantStorage } from "@civitasone/db";
import { courses, modules, lessons, enrollments, lessonProgress } from "../src/modules/learning/schema.js";
import { COMMANDS } from "../src/topics.js";
import { eq, and } from "drizzle-orm";
import { queue } from "../src/shared/infra.js";
import { registerF3_learning_Consumers } from "../src/modules/learning/f3-consumer.js";

// These routes answer 200/201 as soon as the write is QUEUED; the real database write
// happens in the F3 consumer, which buildApp() does NOT register (only worker.ts does).
// Without registering + draining it here the suite asserted only the optimistic HTTP
// response, so the consumer could crash on undefined locals and nothing would notice.
registerF3_learning_Consumers(queue);
async function drainF3() {
  await (queue as unknown as import("@civitasone/queue").MemoryQueue).drain();
}
function f3Dlq() {
  return (queue as unknown as import("@civitasone/queue").MemoryQueue).dlq;
}

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
    await drainF3();
    expect(res.statusCode).toBe(201);
    prereqCourseId = res.json().id;
    res = await app.inject({ method: "POST", url: `/v1/hrms/learning/courses/${prereqCourseId}/publish`, headers: bare(tok(HR)) });
    await drainF3();
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("published");
  });

  it("creates a main course with a module, two lessons, and a prerequisite", async () => {
    let res = await app.inject({ method: "POST", url: "/v1/hrms/learning/courses", headers: auth(tok(HR)),
      payload: { code: `MAIN-${uniq}`, title: "Advanced Governance", category: "governance", creditHours: 8 } });
    await drainF3();
    expect(res.statusCode).toBe(201);
    courseId = res.json().id;

    res = await app.inject({ method: "POST", url: `/v1/hrms/learning/courses/${courseId}/modules`, headers: auth(tok(HR)),
      payload: { title: "Module 1", sequence: 1 } });
    await drainF3();
    expect(res.statusCode).toBe(201);
    moduleId = res.json().id;

    res = await app.inject({ method: "POST", url: `/v1/hrms/learning/modules/${moduleId}/lessons`, headers: auth(tok(HR)),
      payload: { title: "Lesson 1", sequence: 1, contentType: "video", contentUri: "https://cdn/x.mp4", durationMins: 15 } });
    await drainF3();
    expect(res.statusCode).toBe(201);
    l1 = res.json().id;
    res = await app.inject({ method: "POST", url: `/v1/hrms/learning/modules/${moduleId}/lessons`, headers: auth(tok(HR)),
      payload: { title: "Lesson 2", sequence: 2, contentType: "pdf", contentUri: "https://cdn/x.pdf" } });
    await drainF3();
    expect(res.statusCode).toBe(201);
    l2 = res.json().id;

    res = await app.inject({ method: "POST", url: `/v1/hrms/learning/courses/${courseId}/prerequisites`, headers: auth(tok(HR)),
      payload: { prerequisiteCourseId: prereqCourseId } });
    await drainF3();
    expect(res.statusCode).toBe(201);

    res = await app.inject({ method: "POST", url: `/v1/hrms/learning/courses/${courseId}/publish`, headers: bare(tok(HR)) });
    await drainF3();
    expect(res.statusCode).toBe(200);
  });

  it("rejects a self-prerequisite", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/hrms/learning/courses/${courseId}/prerequisites`, headers: auth(tok(HR)),
      payload: { prerequisiteCourseId: courseId } });
    await drainF3();
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("INVALID_PREREQ");
  });

  it("catalogue browse/search returns the course by category", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/hrms/learning/courses?q=governance", headers: bare(tok(HR)) });
    await drainF3();
    expect(res.statusCode).toBe(200);
    expect(res.json().some((c: any) => c.id === courseId)).toBe(true);
  });

  it("course detail includes modules, lessons and prerequisites", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/hrms/learning/courses/${courseId}`, headers: bare(tok(HR)) });
    await drainF3();
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
    await drainF3();
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("PREREQUISITES_NOT_MET");
    expect(res.json().missing).toContain(prereqCourseId);
  });

  it("completing the prerequisite unblocks enrolment and tracks progress", async () => {
    // Give the prerequisite a lesson, enrol the employee, and complete it so
    // the prerequisite gate on the main course is satisfied.
    let res = await app.inject({ method: "POST", url: `/v1/hrms/learning/courses/${prereqCourseId}/modules`, headers: auth(tok(HR)),
      payload: { title: "M", sequence: 1 } });
    await drainF3();
    const preMod = res.json().id;
    res = await app.inject({ method: "POST", url: `/v1/hrms/learning/modules/${preMod}/lessons`, headers: auth(tok(HR)),
      payload: { title: "Only", sequence: 1, contentType: "link" } });
    await drainF3();
    const preLesson = res.json().id;
    res = await app.inject({ method: "POST", url: `/v1/hrms/learning/courses/${prereqCourseId}/enroll`, headers: auth(tok(HR)),
      payload: { employeeId: EMP } });
    await drainF3();
    expect(res.statusCode).toBe(201);
    res = await app.inject({ method: "POST", url: `/v1/hrms/learning/lessons/${preLesson}/progress`, headers: auth(tok(HR)),
      payload: { employeeId: EMP, status: "completed" } });
    await drainF3();
    expect(res.statusCode).toBe(200);
    expect(res.json().progressPct).toBe(100);
    expect(res.json().status).toBe("completed");

    // Now enrolment into the main course is allowed.
    res = await app.inject({ method: "POST", url: `/v1/hrms/learning/courses/${courseId}/enroll`, headers: auth(tok(HR)),
      payload: { employeeId: EMP } });
    await drainF3();
    expect(res.statusCode).toBe(201);
  });

  it("progress updates percent, resume point and status", async () => {
    // Complete lesson 1 of 2 => 50%, in_progress, resume = lesson 2.
    let res = await app.inject({ method: "POST", url: `/v1/hrms/learning/lessons/${l1}/progress`, headers: auth(tok(HR)),
      payload: { employeeId: EMP, status: "completed" } });
    await drainF3();
    expect(res.statusCode).toBe(200);
    expect(res.json().progressPct).toBe(50);
    expect(res.json().status).toBe("in_progress");
    expect(res.json().resumeLessonId).toBe(l2);

    // Complete lesson 2 => 100%, completed, resume = null.
    res = await app.inject({ method: "POST", url: `/v1/hrms/learning/lessons/${l2}/progress`, headers: auth(tok(HR)),
      payload: { employeeId: EMP, status: "completed" } });
    await drainF3();
    expect(res.json().progressPct).toBe(100);
    expect(res.json().status).toBe("completed");
    expect(res.json().resumeLessonId).toBeNull();
  });

  it("my-learning lists the employee's enrolments with progress", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/hrms/learning/my-learning?employeeId=${EMP}`, headers: bare(tok(HR)) });
    await drainF3();
    expect(res.statusCode).toBe(200);
    const rows = res.json();
    const main = rows.find((r: any) => r.courseId === courseId);
    expect(main.progressPct).toBe(100);
    expect(main.courseTitle).toBe("Advanced Governance");
  });

  it("progress on a course the employee is not enrolled in is rejected", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/hrms/learning/lessons/${l1}/progress`, headers: auth(tok(HR)),
      payload: { employeeId: "e4444444-0000-4000-8000-0000000000f9", status: "completed" } });
    await drainF3();
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("NOT_ENROLLED");
  });

  it("re-enrolment is idempotent (200 with existing enrolment)", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/hrms/learning/courses/${courseId}/enroll`, headers: auth(tok(HR)),
      payload: { employeeId: EMP } });
    await drainF3();
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("completed");
  });
});

describe("route guards", () => {
  it("404s course detail for a missing course", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/hrms/learning/courses/${randomUUID()}`, headers: bare(tok(HR)) });
    await drainF3();
    expect(res.statusCode).toBe(404);
  });
  it("404s adding a module to a missing course", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/hrms/learning/courses/${randomUUID()}/modules`, headers: auth(tok(HR)),
      payload: { title: "M" } });
    await drainF3();
    expect(res.statusCode).toBe(404);
  });
  it("404s adding a lesson to a missing module", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/hrms/learning/modules/${randomUUID()}/lessons`, headers: auth(tok(HR)),
      payload: { title: "L", contentType: "link" } });
    await drainF3();
    expect(res.statusCode).toBe(404);
  });
  it("409s enrolment in an unpublished (draft) course", async () => {
    let res = await app.inject({ method: "POST", url: "/v1/hrms/learning/courses", headers: auth(tok(HR)),
      payload: { code: `DRAFT-${uniq}`, title: "Draft" } });
    await drainF3();
    const draftId = res.json().id;
    res = await app.inject({ method: "POST", url: `/v1/hrms/learning/courses/${draftId}/enroll`, headers: auth(tok(HR)),
      payload: { employeeId: EMP } });
    await drainF3();
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("NOT_PUBLISHED");
  });
  it("409s publishing an already-published course", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/hrms/learning/courses/${courseId}/publish`, headers: bare(tok(HR)) });
    await drainF3();
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("INVALID_STATE");
  });
  it("404s a prerequisite referencing a missing course", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/hrms/learning/courses/${courseId}/prerequisites`, headers: auth(tok(HR)),
      payload: { prerequisiteCourseId: randomUUID() } });
    await drainF3();
    expect(res.statusCode).toBe(404);
  });
});


// ─────────────────────────────────────────────────────────────────────────────
// F3 write-consumer regression tests.
//
// The routes above answer 200/201 the moment the command is queued, so a crash in
// the consumer is invisible to them. These tests drive the consumer directly — the
// only place the write actually happens. Before the fix, `learning_routes__4` threw
// on an undefined `mod` and `learning_routes__6` on undefined `lesson`/`enrollment`,
// both landing in the DLQ having written nothing (so lesson progress, completion
// percentage and the resume pointer were never recorded at all).
// ─────────────────────────────────────────────────────────────────────────────
describe("F3 write consumer — learning", () => {
  const F_COURSE = randomUUID();
  const F_MODULE = randomUUID();
  const F_LESSON1 = randomUUID();
  const F_LESSON2 = randomUUID();
  const F_EMP = randomUUID();
  const F_ENROLL = randomUUID();

  async function publishF3(op: string, id: string, params: Record<string, unknown>, body: Record<string, unknown> = {}) {
    tenantStorage.enterWith({ tenantId: TENANT });
    await queue.publish(COMMANDS.f3RouteWrite, {
      messageId: randomUUID(),
      type: COMMANDS.f3RouteWrite,
      tenantId: TENANT,
      actorId: HR,
      correlationId: randomUUID(),
      schemaVersion: "1.0",
      payload: { op, id, tenantId: TENANT, body, params, query: {} },
    });
    await drainF3();
  }

  beforeAll(async () => {
    tenantStorage.enterWith({ tenantId: TENANT });
    await db.transaction(async (tx) => {
      await tx.insert(courses).values({
        id: F_COURSE, tenantId: TENANT, code: `F3-${uniq}`, title: "F3 Course",
        category: "general", creditHours: "1", status: "published", createdBy: HR,
      });
      await tx.insert(modules).values({
        id: F_MODULE, tenantId: TENANT, courseId: F_COURSE, title: "F3 Module", sequence: 1,
      });
      await tx.insert(enrollments).values({
        id: F_ENROLL, tenantId: TENANT, courseId: F_COURSE, employeeId: F_EMP,
        status: "enrolled", progressPct: 0,
      });
    });
    f3Dlq().length = 0;
  });

  it("learning_routes__4 — denormalises courseId from the parent module onto the lesson", async () => {
    tenantStorage.enterWith({ tenantId: TENANT });
    await publishF3("learning_routes__4", F_MODULE, { id: F_MODULE },
      { title: "F3 Lesson 1", sequence: 1, contentType: "video", durationMins: 10 });

    expect(f3Dlq()).toHaveLength(0);
    const rows = await db.transaction((tx) => tx.select().from(lessons)
      .where(and(eq(lessons.tenantId, TENANT), eq(lessons.moduleId, F_MODULE))));
    expect(rows).toHaveLength(1);
    // This is the value that was unreachable before the fix (`mod` was undefined).
    expect(rows[0]!.courseId).toBe(F_COURSE);
    expect(rows[0]!.durationMins).toBe(10);
  });

  it("learning_routes__4 — reapplies the route's Zod defaults for sequence/durationMins", async () => {
    tenantStorage.enterWith({ tenantId: TENANT });
    const mod2 = randomUUID();
    await db.transaction(async (tx) => {
      await tx.insert(modules).values({
        id: mod2, tenantId: TENANT, courseId: F_COURSE, title: "F3 Module 2", sequence: 2,
      });
    });
    await publishF3("learning_routes__4", mod2, { id: mod2 },
      { title: "F3 Lesson bare", contentType: "pdf" });

    expect(f3Dlq()).toHaveLength(0);
    const rows = await db.transaction((tx) => tx.select().from(lessons)
      .where(and(eq(lessons.tenantId, TENANT), eq(lessons.moduleId, mod2))));
    expect(rows[0]!.sequence).toBe(1);
    expect(rows[0]!.durationMins).toBe(0);
  });

  it("learning_routes__6 — records progress and recomputes percent, status and resume point", async () => {
    tenantStorage.enterWith({ tenantId: TENANT });
    // A dedicated course with exactly two lessons, so the percentages are deterministic
    // regardless of what the other tests in this describe added to F_COURSE.
    const course2 = randomUUID();
    const module2 = randomUUID();
    const enroll2 = randomUUID();
    const emp2 = randomUUID();
    await db.transaction(async (tx) => {
      await tx.insert(courses).values({
        id: course2, tenantId: TENANT, code: `F3P-${uniq}`, title: "F3 Progress Course",
        category: "general", creditHours: "1", status: "published", createdBy: HR,
      });
      await tx.insert(modules).values({
        id: module2, tenantId: TENANT, courseId: course2, title: "F3 Progress Module", sequence: 1,
      });
      await tx.insert(lessons).values([
        { id: F_LESSON1, tenantId: TENANT, moduleId: module2, courseId: course2, title: "L1", sequence: 1, contentType: "video" },
        { id: F_LESSON2, tenantId: TENANT, moduleId: module2, courseId: course2, title: "L2", sequence: 2, contentType: "pdf" },
      ]);
      await tx.insert(enrollments).values({
        id: enroll2, tenantId: TENANT, courseId: course2, employeeId: emp2,
        status: "enrolled", progressPct: 0,
      });
    });

    await publishF3("learning_routes__6", F_LESSON1, { id: F_LESSON1 },
      { employeeId: emp2, status: "completed" });
    expect(f3Dlq()).toHaveLength(0);

    const prog = await db.transaction((tx) => tx.select().from(lessonProgress)
      .where(and(eq(lessonProgress.tenantId, TENANT), eq(lessonProgress.lessonId, F_LESSON1))));
    expect(prog).toHaveLength(1);
    // enrollmentId was unreachable before the fix (`enrollment` was undefined).
    expect(prog[0]!.enrollmentId).toBe(enroll2);

    let enr = await db.transaction((tx) => tx.select().from(enrollments)
      .where(and(eq(enrollments.tenantId, TENANT), eq(enrollments.id, enroll2))));
    expect(enr[0]!.progressPct).toBe(50);
    expect(enr[0]!.status).toBe("in_progress");
    expect(enr[0]!.resumeLessonId).toBe(F_LESSON2);

    // Completing the remaining lesson takes the enrolment to 100% / completed.
    await publishF3("learning_routes__6", F_LESSON2, { id: F_LESSON2 },
      { employeeId: emp2, status: "completed" });
    expect(f3Dlq()).toHaveLength(0);

    enr = await db.transaction((tx) => tx.select().from(enrollments)
      .where(and(eq(enrollments.tenantId, TENANT), eq(enrollments.id, enroll2))));
    expect(enr[0]!.progressPct).toBe(100);
    expect(enr[0]!.status).toBe("completed");
    expect(enr[0]!.completedAt).not.toBeNull();
  });

  it("learning_routes__6 — reapplies the route's Zod default for status", async () => {
    tenantStorage.enterWith({ tenantId: TENANT });
    const course3 = randomUUID();
    const module3 = randomUUID();
    const lesson3 = randomUUID();
    const enroll3 = randomUUID();
    const emp3 = randomUUID();
    await db.transaction(async (tx) => {
      await tx.insert(courses).values({
        id: course3, tenantId: TENANT, code: `F3S-${uniq}`, title: "F3 Status Course",
        category: "general", creditHours: "1", status: "published", createdBy: HR,
      });
      await tx.insert(modules).values({
        id: module3, tenantId: TENANT, courseId: course3, title: "M", sequence: 1,
      });
      await tx.insert(lessons).values({
        id: lesson3, tenantId: TENANT, moduleId: module3, courseId: course3, title: "L", sequence: 1, contentType: "pdf",
      });
      await tx.insert(enrollments).values({
        id: enroll3, tenantId: TENANT, courseId: course3, employeeId: emp3, status: "enrolled", progressPct: 0,
      });
    });

    // lessonProgressBody declares status z.enum([...]).default("completed").
    await publishF3("learning_routes__6", lesson3, { id: lesson3 }, { employeeId: emp3 });
    expect(f3Dlq()).toHaveLength(0);

    const prog = await db.transaction((tx) => tx.select().from(lessonProgress)
      .where(and(eq(lessonProgress.tenantId, TENANT), eq(lessonProgress.lessonId, lesson3))));
    expect(prog[0]!.status).toBe("completed");
    expect(prog[0]!.completedAt).not.toBeNull();
  });
});
