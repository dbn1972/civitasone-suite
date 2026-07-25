/** CAP-029 — finalization routes: finalize, edit-guard, reversal authority. */
import { describe, it, expect, afterAll, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "a9000000-1111-4000-8000-000000000001";

function token(roles: string[]) {
  return signToken({ sub: randomUUID(), tid: TENANT, roles, sid: "s" }, SECRET);
}

async function seedInstance(): Promise<string> {
  const id = randomUUID();
  const actor = randomUUID();
  await db.execute(sql`INSERT INTO workflow.instances (id, tenant_id, name, status, created_by, updated_by)
    VALUES (${id}, ${TENANT}, 'Final inst', 'active', ${actor}, ${actor})`);
  return id;
}

afterEach(async () => {
  await db.execute(sql`DELETE FROM workflow.instance_finalizations WHERE tenant_id = ${TENANT}`);
  await db.execute(sql`DELETE FROM workflow.instances WHERE tenant_id = ${TENANT}`);
});
afterAll(async () => { await sqlClient.end(); });

describe("CAP-029 finalize + edit guard", () => {
  it("finalizes an instance and then blocks edits until reversed", async () => {
    const app = await buildApp();
    const id = await seedInstance();
    const fin = await app.inject({ method: "POST", url: `/v1/workflow/instances/${id}/finalize`, headers: { authorization: `Bearer ${token(["workflow_admin"])}` } });
    expect(fin.statusCode).toBe(201);

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
    await app.inject({ method: "POST", url: `/v1/workflow/instances/${id}/finalize`, headers: { authorization: `Bearer ${token(["workflow_admin"])}` } });

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

    // authorised + reasoned + unblocked → success
    const ok = await app.inject({
      method: "POST", url: `/v1/workflow/instances/${id}/reverse`,
      headers: { authorization: `Bearer ${token(["tenant_admin"])}` },
      payload: { reason: "audit correction", dependencies: [] },
    });
    await app.close();
    expect(ok.statusCode).toBe(200);
    expect(ok.json().data.reversed).toBe(true);
    expect(ok.json().impact.reversible).toBe(true);
  });
});
