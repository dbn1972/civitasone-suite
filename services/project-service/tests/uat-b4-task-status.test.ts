/**
 * UAT B4 — GAP-PROJECTS-DETAIL-TASKS-01: PATCH /v1/projects/:id/tasks/:taskId/status
 * refuses a foreign / unknown task (404) and an illegal transition (422)
 * synchronously, and the consumer refuses a command that names the wrong project.
 * Real Postgres + real RLS; the queue is a capturing stub replayed into the
 * real consumer. Unique per-file ids.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";

const captured = vi.hoisted(() => ({ msgs: [] as Array<{ type: string; envelope: Record<string, unknown> }> }));
vi.mock("../src/shared/infra.js", () => ({
  cache: { getOrLoad: vi.fn(), invalidate: vi.fn(), makeKey: vi.fn().mockReturnValue("k") },
  queue: {
    publish: (type: string, envelope: Record<string, unknown>) => {
      captured.msgs.push({ type, envelope });
      return Promise.resolve();
    },
  },
}));

import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { projectProjects, projectTasks } from "../src/modules/project/schema.js";
import { registerProjectConsumers } from "../src/modules/project/consumer.js";

const SECRET = process.env.JWT_SECRET ?? "";
const TENANT = randomUUID();
const ACTOR = randomUUID();
const PROJECT = randomUUID();
const OTHER_PROJECT = randomUUID();
const TASK = randomUUID();

const tx = <T>(fn: (t: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>) =>
  runWithTenant(TENANT, () => db.transaction(fn));

const headers = (roles: string[]) => ({
  authorization: `Bearer ${signToken({ sub: ACTOR, tid: TENANT, roles, sid: randomUUID() }, SECRET)}`,
  "x-tenant-id": TENANT,
});

const patch = (app: Awaited<ReturnType<typeof buildApp>>, projectId: string, taskId: string, body: object, roles = ["project_manager"]) =>
  app.inject({ method: "PATCH", url: `/v1/projects/${projectId}/tasks/${taskId}/status`, headers: headers(roles), payload: body });

const taskRow = async () => (await tx((x) => x.select().from(projectTasks).where(eq(projectTasks.id, TASK))))[0]!;

async function drain() {
  const q = new MemoryQueue();
  registerProjectConsumers(q);
  await q.start();
  for (const m of captured.msgs.splice(0)) await q.publish(m.type, m.envelope as never);
  await q.drain();
  await q.stop();
  return (q as unknown as MemoryQueue).dlq;
}

const clean = async () => {
  await tx((x) => x.delete(projectTasks).where(eq(projectTasks.tenantId, TENANT)));
  await tx((x) => x.delete(projectProjects).where(eq(projectProjects.tenantId, TENANT)));
};

let app: Awaited<ReturnType<typeof buildApp>>;
const seed = async (status = "pending") => {
  captured.msgs.length = 0;
  await clean();
  await tx((x) =>
    x.insert(projectProjects).values({ id: PROJECT, tenantId: TENANT, code: `B4-${PROJECT.slice(0, 8)}`, name: "B4 fixture", createdBy: ACTOR, updatedBy: ACTOR }),
  );
  await tx((x) =>
    x.insert(projectTasks).values({
      id: TASK, projectId: PROJECT, tenantId: TENANT, name: "Foundation", status, createdBy: ACTOR, updatedBy: ACTOR,
    }),
  );
};
beforeAll(async () => { app = await buildApp(); await app.ready(); });
beforeEach(() => seed());
afterAll(async () => {
  await clean();
  await app.close();
  await sqlClient.end();
});

describe("GAP-PROJECTS-DETAIL-TASKS-01 task status update", () => {
  it("a legal transition is accepted and applied by the consumer with progress", async () => {
    const res = await patch(app, PROJECT, TASK, { status: "in_progress", progressPct: 40 });
    expect(res.statusCode).toBe(202);
    expect(await drain()).toHaveLength(0);
    const row = await taskRow();
    expect(row.status).toBe("in_progress");
    expect(Number(row.progressPct)).toBe(40);
  });

  it("an illegal transition is a synchronous 422 and nothing is published", async () => {
    await seed("completed");
    const res = await patch(app, PROJECT, TASK, { status: "pending" });
    expect(res.statusCode).toBe(422);
    expect(captured.msgs).toHaveLength(0);
    expect((await taskRow()).status).toBe("completed");
  });

  it("a task of another project is 404 (ownership) and nothing is published", async () => {
    const res = await patch(app, OTHER_PROJECT, TASK, { status: "in_progress" });
    expect(res.statusCode).toBe(404);
    expect(captured.msgs).toHaveLength(0);
  });

  it("the consumer refuses a forged command naming the wrong project", async () => {
    captured.msgs.push({
      type: "project.task.status",
      envelope: {
        messageId: randomUUID(), type: "project.task.status", tenantId: TENANT, actorId: ACTOR,
        correlationId: randomUUID(), schemaVersion: "1.0",
        payload: { taskId: TASK, tenantId: TENANT, projectId: OTHER_PROJECT, status: "in_progress" },
      },
    });
    expect(await drain()).toHaveLength(1);
    expect((await taskRow()).status).toBe("pending");
  });

  it("a read-only role is 403", async () => {
    const res = await patch(app, PROJECT, TASK, { status: "in_progress" }, ["audit_officer"]);
    expect(res.statusCode).toBe(403);
  });
});
