/**
 * UAT W6-A (P1 accept-nonexistent): milestone complete, task update and the escalation
 * actions published without reading their target, so random ids got 202. Each now does a
 * tenant-scoped existence read first (child routes also check the child belongs to the
 * project): unknown -> 404 and nothing published; real -> 202 and the command is published.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { projectProjects, projectTasks, projectMilestones } from "../src/modules/project/schema.js";

const SECRET = process.env.JWT_SECRET as string;
const TENANT = randomUUID();
const OTHER_TENANT = randomUUID();
const ACTOR = randomUUID();
const PROJECT = randomUUID();
const OTHER_PROJECT = randomUUID();
const TASK = randomUUID();
const MILESTONE = randomUUID();

const hdr = (tenant = TENANT) => ({
  authorization: `Bearer ${signToken({ sub: ACTOR, tid: tenant, roles: ["project_manager", "super_admin"], sid: "s" }, SECRET, 3600)}`,
});

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.insert(projectProjects).values([
      { id: PROJECT, tenantId: TENANT, code: `W6A-${PROJECT.slice(0, 6)}`, name: "W6A project", createdBy: ACTOR, updatedBy: ACTOR },
      { id: OTHER_PROJECT, tenantId: TENANT, code: `W6B-${OTHER_PROJECT.slice(0, 6)}`, name: "W6A other project", createdBy: ACTOR, updatedBy: ACTOR },
    ]);
    await tx.insert(projectTasks).values({ id: TASK, projectId: PROJECT, tenantId: TENANT, name: "W6A task", createdBy: ACTOR, updatedBy: ACTOR });
    await tx.insert(projectMilestones).values({ id: MILESTONE, projectId: PROJECT, tenantId: TENANT, name: "W6A milestone", plannedDate: "2026-12-31", createdBy: ACTOR, updatedBy: ACTOR });
  }));
});

afterAll(async () => {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.delete(projectMilestones).where(eq(projectMilestones.tenantId, TENANT));
    await tx.delete(projectTasks).where(eq(projectTasks.tenantId, TENANT));
    await tx.delete(projectProjects).where(eq(projectProjects.tenantId, TENANT));
  })).catch(() => undefined);
  await app.close();
  await sqlClient.end();
});

async function expectRefused(method: "POST" | "PATCH", url: string, payload: Record<string, unknown>, tenant = TENANT): Promise<void> {
  const spy = vi.spyOn(queue, "publish");
  try {
    const res = await app.inject({ method, url, headers: hdr(tenant), payload });
    expect(res.statusCode).toBe(404);
    expect(spy).not.toHaveBeenCalled();
  } finally {
    spy.mockRestore();
  }
}

async function expectAccepted(method: "POST" | "PATCH", url: string, payload: Record<string, unknown>): Promise<void> {
  const spy = vi.spyOn(queue, "publish").mockResolvedValue(undefined as never);
  try {
    const res = await app.inject({ method, url, headers: hdr(), payload });
    expect(res.statusCode).toBe(202);
    expect(spy).toHaveBeenCalled();
    expect(spy.mock.calls[0]![1]).toMatchObject({ tenantId: TENANT });
  } finally {
    spy.mockRestore();
  }
}

describe("UAT W6-A: PATCH /v1/projects/:id/milestones/:mId/complete", () => {
  const url = (p: string, m: string) => `/v1/projects/${p}/milestones/${m}/complete`;
  it("random milestone -> 404, nothing published", () => expectRefused("PATCH", url(PROJECT, randomUUID()), {}));
  it("real milestone under the wrong project -> 404", () => expectRefused("PATCH", url(OTHER_PROJECT, MILESTONE), {}));
  it("another tenant -> 404", () => expectRefused("PATCH", url(PROJECT, MILESTONE), {}, OTHER_TENANT));
  it("real milestone of the project -> 202 and published", () => expectAccepted("PATCH", url(PROJECT, MILESTONE), {}));
});

describe("UAT W6-A: PATCH /v1/projects/:id/tasks/:taskId", () => {
  const url = (p: string, t: string) => `/v1/projects/${p}/tasks/${t}`;
  it("random task -> 404, nothing published", () => expectRefused("PATCH", url(PROJECT, randomUUID()), { name: "x" }));
  it("real task under the wrong project -> 404", () => expectRefused("PATCH", url(OTHER_PROJECT, TASK), { name: "x" }));
  it("another tenant -> 404", () => expectRefused("PATCH", url(PROJECT, TASK), { name: "x" }, OTHER_TENANT));
  it("real task of the project -> 202 and published", () => expectAccepted("PATCH", url(PROJECT, TASK), { name: "W6A renamed" }));
});

describe("UAT W6-A: POST /v1/projects/:id/escalation/*", () => {
  const cases: Array<[string, Record<string, unknown>]> = [
    ["acknowledge", {}],
    ["reassign", { escalatedTo: "District Engineer" }],
    ["clear", { reason: "resolved on site" }],
  ];
  for (const [action, payload] of cases) {
    it(`${action}: random project -> 404, nothing published`, () => expectRefused("POST", `/v1/projects/${randomUUID()}/escalation/${action}`, payload));
    it(`${action}: another tenant's project -> 404`, () => expectRefused("POST", `/v1/projects/${PROJECT}/escalation/${action}`, payload, OTHER_TENANT));
    it(`${action}: real project -> 202 and published`, () => expectAccepted("POST", `/v1/projects/${PROJECT}/escalation/${action}`, payload));
  }
});
