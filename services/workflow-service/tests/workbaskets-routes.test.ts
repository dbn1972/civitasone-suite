/** CAP-035/036 — workbaskets over tasks + checklist gating, HTTP + DB. */
import { describe, it, expect, afterAll, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerWorkbasketConsumers } from "../src/modules/workbaskets/consumer.js";
import { sqlAsTenant } from "./helpers/engine-harness.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "c1050000-0000-4000-8000-000000000035";
const tok = (roles = ["case_manager"]) => signToken({ sub: randomUUID(), tid: TENANT, roles, sid: "s" }, SECRET);

registerWorkbasketConsumers(queue);
await queue.start();

async function waitFor<T>(fn: () => Promise<T | null | undefined>, ms = 3000): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < ms) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("waitFor timeout");
}

async function seedTask(status: string, instanceId: string): Promise<void> {
  const id = randomUUID(); const actor = randomUUID();
  await sqlAsTenant(TENANT, sql`INSERT INTO workflow.instances (id, tenant_id, name, status, created_by, updated_by)
    VALUES (${instanceId}, ${TENANT}, 'inst', 'active', ${actor}, ${actor}) ON CONFLICT DO NOTHING`);
  await sqlAsTenant(TENANT, sql`INSERT INTO workflow.tasks (id, tenant_id, instance_id, name, status, created_by, updated_by)
    VALUES (${id}, ${TENANT}, ${instanceId}, 'task', ${status}, ${actor}, ${actor})`);
}

afterEach(async () => {
  await sqlAsTenant(TENANT, sql`DELETE FROM workflow.tasks WHERE tenant_id = ${TENANT}`);
  await sqlAsTenant(TENANT, sql`DELETE FROM workflow.instances WHERE tenant_id = ${TENANT}`);
  await sqlAsTenant(TENANT, sql`DELETE FROM workflow.workbaskets WHERE tenant_id = ${TENANT}`);
});
afterAll(async () => { await sqlClient.end(); });

describe("CAP-035 workbaskets", () => {
  it("saves a filtered basket and resolves it to matching tasks only", async () => {
    const app = await buildApp();
    const inst = randomUUID();
    await seedTask("pending", inst);
    await seedTask("pending", inst);
    await seedTask("completed", inst);
    const h = { authorization: `Bearer ${tok()}` };
    const put = await app.inject({ method: "PUT", url: "/v1/workflow/workbaskets/pending-queue", headers: h, payload: { name: "Pending", filter: { status: ["pending"] } } });
    expect(put.statusCode).toBe(202);
    const resolved = await waitFor(async () => {
      const g = await app.inject({ method: "GET", url: "/v1/workflow/workbaskets/pending-queue/tasks", headers: h });
      return g.statusCode === 200 ? g : null;
    });
    expect(resolved.json().meta.total).toBe(2);
    await app.close();
  });

  it("rejects a basket with an invalid status filter", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "PUT", url: "/v1/workflow/workbaskets/bad", headers: { authorization: `Bearer ${tok()}` }, payload: { name: "Bad", filter: { status: ["nonsense"] } } });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});
