/** CAP-029 — finalization routes: finalize, edit-guard, reversal authority. */
import { describe, it, expect, afterAll, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerFinalizationConsumers } from "../src/modules/finalization/consumer.js";
import { sqlAsTenant } from "./helpers/engine-harness.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "a9000000-1111-4000-8000-000000000001";

function token(roles: string[]) {
  return signToken({ sub: randomUUID(), tid: TENANT, roles, sid: "s" }, SECRET);
}

registerFinalizationConsumers(queue);
await queue.start();

async function seedInstance(): Promise<string> {
  const id = randomUUID();
  const actor = randomUUID();
  await sqlAsTenant(TENANT, sql`INSERT INTO workflow.instances (id, tenant_id, name, status, created_by, updated_by)
    VALUES (${id}, ${TENANT}, 'Final inst', 'active', ${actor}, ${actor})`);
  return id;
}

afterEach(async () => {
  await sqlAsTenant(TENANT, sql`DELETE FROM workflow.instance_finalizations WHERE tenant_id = ${TENANT}`);
  await sqlAsTenant(TENANT, sql`DELETE FROM workflow.instances WHERE tenant_id = ${TENANT}`);
});
afterAll(async () => { await sqlClient.end(); });

async function waitFor<T>(fn: () => Promise<T | null | undefined>, ms = 3000): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < ms) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("waitFor timeout");
}

async function waitForFinalized(app: Awaited<ReturnType<typeof buildApp>>, id: string, roles: string[]) {
  return waitFor(async () => {
    const g = await app.inject({ method: "GET", url: `/v1/workflow/instances/${id}/finalization`, headers: { authorization: `Bearer ${token(roles)}` } });
    return g.json().data?.finalized ? g.json().data : null;
  });
}

describe("CAP-029 finalize + edit guard", () => {
  it("finalizes an instance and then blocks edits until reversed", async () => {
    const app = await buildApp();
    const id = await seedInstance();
    const fin = await app.inject({ method: "POST", url: `/v1/workflow/instances/${id}/finalize`, headers: { authorization: `Bearer ${token(["workflow_admin"])}` } });
    expect(fin.statusCode).toBe(202);
    await waitForFinalized(app, id, ["workflow_admin"]);

    const dup = await app.inject({ method: "POST", url: `/v1/workflow/instances/${id}/finalize`, headers: { authorization: `Bearer ${token(["workflow_admin"])}` } });
    expect(dup.statusCode).toBe(409); // ALREADY_FINALIZED

    const edit = await app.inject({ method: "POST", url: `/v1/workflow/instances/${id}/guarded-edit`, headers: { authorization: `Bearer ${token(["workflow_admin"])}` } });
    await app.close();
    expect(edit.statusCode).toBe(409); // INSTANCE_FINALIZED
  });
});

describe("CAP-029 reversal authority guard", () => {
  it("blocks reversal without reversal authority and blocks on a blocking dependency", async () => {
    const app = await buildApp();
    const id = await seedInstance();
    const fin = await app.inject({ method: "POST", url: `/v1/workflow/instances/${id}/finalize`, headers: { authorization: `Bearer ${token(["workflow_admin"])}` } });
    expect(fin.statusCode).toBe(202);
    // The /reverse route reads currently-committed finalization state
    // synchronously, so the finalize write must actually land first --
    // otherwise it 404s NOT_FINALIZED before ever reaching the authority
    // check, which is what the async conversion regressed here.
    await waitForFinalized(app, id, ["workflow_admin"]);

    // workflow_admin lacks reversal authority (super_admin/tenant_admin only)
    const noAuth = await app.inject({
      method: "POST", url: `/v1/workflow/instances/${id}/reverse`,
      headers: { authorization: `Bearer ${token(["workflow_admin"])}` },
      payload: { reason: "correction" },
    });
    expect(noAuth.statusCode).toBe(403);

    // authorised but a blocking dependency stops the reversal
    const blocked = await app.inject({
      method: "POST", url: `/v1/workflow/instances/${id}/reverse`,
      headers: { authorization: `Bearer ${token(["tenant_admin"])}` },
      payload: { reason: "correction", dependencies: [{ type: "payment", id: "p1", blocking: true }] },
    });
    expect(blocked.statusCode).toBe(409); // REVERSAL_BLOCKED

    // authorised + reasoned + unblocked → accepted, and eventually reversed
    const ok = await app.inject({
      method: "POST", url: `/v1/workflow/instances/${id}/reverse`,
      headers: { authorization: `Bearer ${token(["tenant_admin"])}` },
      payload: { reason: "audit correction", dependencies: [] },
    });
    expect(ok.statusCode).toBe(202);
    const impact = await app.inject({
      method: "POST", url: `/v1/workflow/instances/${id}/reversal-impact`,
      headers: { authorization: `Bearer ${token(["tenant_admin"])}` },
      payload: { dependencies: [] },
    });
    expect(impact.json().data.reversible).toBe(true);
    const state = await waitFor(async () => {
      const g = await app.inject({ method: "GET", url: `/v1/workflow/instances/${id}/finalization`, headers: { authorization: `Bearer ${token(["tenant_admin"])}` } });
      return g.json().data?.reversed ? g.json().data : null;
    });
    await app.close();
    expect(state.reversed).toBe(true);
  });
});
