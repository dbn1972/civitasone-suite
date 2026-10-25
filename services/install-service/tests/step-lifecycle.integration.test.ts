/**
 * PATCH /v1/install/steps/:id/:verb — end-to-end contract (real DB, real consumer).
 *
 * The web's Run / Skip / Retry buttons call this route with an install STAGE id
 * (/v1/install/steps is a 1:1 view over install.stages). The route used to publish
 * {id, tenantId, verb} on install.step.start / install.step.skip, whose only
 * consumer (orchestrator) expects a wizard {wizardId, stepKey} -- so the command
 * was consumed and did nothing. These tests drive route -> queue -> consumer -> DB
 * -> GET /v1/install/steps and pin that the status really moves, and that a failed
 * step is reported as failed WITH its errorMessage (it used to be collapsed to
 * "pending" with no message).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { stages } from "../src/modules/stages/schema.js";
import { registerStageConsumers } from "../src/modules/stages/consumer.js";
import { COMMANDS } from "../src/topics.js";

const SECRET = process.env.JWT_SECRET as string;
const TENANT = randomUUID();
const OTHER_TENANT = randomUUID();
const ACTOR = randomUUID();

const headers = (tenant = TENANT, roles = ["install_admin"]) => ({
  authorization: `Bearer ${signToken({ sub: ACTOR, tid: tenant, roles }, SECRET, 3600)}`,
});

let app: FastifyInstance;

type Step = { id: string; status: string; errorMessage?: string; stepNo: number };

async function listSteps(tenant = TENANT): Promise<Step[]> {
  const res = await app.inject({ method: "GET", url: "/v1/install/steps", headers: headers(tenant) });
  expect(res.statusCode).toBe(200);
  return res.json() as Step[];
}

async function waitForStatus(id: string, status: string): Promise<Step> {
  let last: Step | undefined;
  // Deadline-based, not a fixed iteration count: each listSteps() is an HTTP round trip plus a
  // DB read, so a count of 60 x 50ms gave well under the intended 3s on a loaded CI runner
  // (the first request of the file also pays cold-start cost). Polls just as fast, ends as soon
  // as the consumer has applied the change, and still fails when it never does.
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    last = (await listSteps()).find((s) => s.id === id);
    if (last?.status === status) return last;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`step ${id} never reached ${status}; last=${JSON.stringify(last)}`);
}

async function createStage(stepNumber: number): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/v1/install/stages",
    headers: headers(),
    payload: { name: `lifecycle-${stepNumber}`, stepNumber },
  });
  expect(res.statusCode).toBe(202);
  const id = res.json().id as string;
  await waitForStatus(id, "pending");
  return id;
}

async function forceStage(id: string, patch: Partial<typeof stages.$inferInsert>): Promise<void> {
  await runWithTenant(TENANT, () =>
    db.transaction((tx) => tx.update(stages).set(patch).where(eq(stages.id, id))),
  );
}

const patch = (id: string, verb: string, tenant = TENANT, body?: Record<string, unknown>, roles?: string[]) =>
  app.inject({ method: "PATCH", url: `/v1/install/steps/${id}/${verb}`, headers: headers(tenant, roles), ...(body ? { payload: body } : {}) });

beforeAll(async () => {
  app = await buildApp();
  registerStageConsumers(queue);
  await queue.start();
});

afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

describe("PATCH /v1/install/steps/:id/:verb", () => {
  it("run moves a pending step to in_progress (consumer applies it)", async () => {
    const id = await createStage(1);
    const res = await patch(id, "run");
    expect(res.statusCode).toBe(202);
    const step = await waitForStatus(id, "in_progress");
    expect(step.errorMessage).toBeUndefined();
  });

  it("skip closes a pending step as skipped, and a skipped step can be run again", async () => {
    const id = await createStage(2);
    expect((await patch(id, "skip")).statusCode).toBe(202);
    await waitForStatus(id, "skipped");
    expect((await patch(id, "run")).statusCode).toBe(202);
    await waitForStatus(id, "in_progress");
  });

  it("a failed step is reported as failed WITH its errorMessage, and retry clears it", async () => {
    const id = await createStage(3);
    await forceStage(id, { status: "failed", errorMessage: "provisioning timed out" });
    // cache is keyed per tenant/resource; list loads were invalidated by the consumer, bust again for the direct write
    const { cache } = await import("../src/shared/infra.js");
    await cache.invalidateResource(TENANT, "stage");
    const failed = await waitForStatus(id, "failed");
    expect(failed.errorMessage).toBe("provisioning timed out");

    expect((await patch(id, "retry")).statusCode).toBe(202);
    const retried = await waitForStatus(id, "in_progress");
    expect(retried.errorMessage).toBeUndefined();
  });

  it("rejects a verb that is not legal from the current status with 409", async () => {
    const id = await createStage(4);
    const res = await patch(id, "retry"); // retry only applies to failed
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("INVALID_TRANSITION");
  });

  it("404 for an unknown step and for another tenant's step (no cross-tenant transition)", async () => {
    expect((await patch(randomUUID(), "run")).statusCode).toBe(404);
    const id = await createStage(5);
    expect((await patch(id, "run", OTHER_TENANT)).statusCode).toBe(404);
    expect((await listSteps()).find((s) => s.id === id)?.status).toBe("pending");
  });

  it("never publishes on the wizard step topics (their consumer expects {wizardId, stepKey})", async () => {
    const id = await createStage(6);
    const topics: string[] = [];
    const rawPublish = queue.publish.bind(queue);
    (queue as { publish: typeof queue.publish }).publish = ((topic: string, env: never) => {
      topics.push(topic);
      return rawPublish(topic, env);
    }) as typeof queue.publish;
    try {
      expect((await patch(id, "run")).statusCode).toBe(202);
    } finally {
      (queue as { publish: typeof queue.publish }).publish = rawPublish;
    }
    expect(topics).toContain(COMMANDS.transitionStage);
    expect(topics).not.toContain(COMMANDS.stepStart);
    expect(topics).not.toContain(COMMANDS.stepSkip);
    await waitForStatus(id, "in_progress");
  });
});

describe("Q9 Mark complete / Mark failed", () => {
  it("complete moves an in_progress step to completed with completedAt", async () => {
    const id = await createStage(20);
    await patch(id, "run");
    await waitForStatus(id, "in_progress");
    expect((await patch(id, "complete")).statusCode).toBe(202);
    const step = await waitForStatus(id, "completed");
    expect(step.errorMessage).toBeUndefined();
  });

  it("fail needs remarks (400), then records them as the step error", async () => {
    const id = await createStage(21);
    await patch(id, "run");
    await waitForStatus(id, "in_progress");
    const noRemarks = await patch(id, "fail");
    expect(noRemarks.statusCode).toBe(400);
    expect(noRemarks.json().code).toBe("VALIDATION_FAILED");
    expect((await patch(id, "fail", TENANT, { remarks: "   " })).statusCode).toBe(400);
    expect((await patch(id, "fail", TENANT, { remarks: "DNS not delegated" })).statusCode).toBe(202);
    const step = await waitForStatus(id, "failed");
    expect(step.errorMessage).toBe("DNS not delegated");
  });

  it("complete/fail are illegal (409) from a pending step", async () => {
    const id = await createStage(22);
    expect((await patch(id, "complete")).statusCode).toBe(409);
    expect((await patch(id, "fail", TENANT, { remarks: "x" })).statusCode).toBe(409);
  });

  it("install_user (read-only) is denied 403 on complete and fail", async () => {
    const id = await createStage(23);
    await patch(id, "run");
    await waitForStatus(id, "in_progress");
    expect((await patch(id, "complete", TENANT, undefined, ["install_user"])).statusCode).toBe(403);
    expect((await patch(id, "fail", TENANT, { remarks: "x" }, ["install_user"])).statusCode).toBe(403);
    expect((await listSteps()).find((s) => s.id === id)?.status).toBe("in_progress");
  });

  it("another tenant cannot complete this tenant's step (404)", async () => {
    const id = await createStage(24);
    await patch(id, "run");
    await waitForStatus(id, "in_progress");
    expect((await patch(id, "complete", OTHER_TENANT)).statusCode).toBe(404);
  });
});
