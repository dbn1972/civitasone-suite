/**
 * CAP-030 — version pinning + rollback integration. Publishing a new version
 * (or rolling back) must NOT move an in-flight instance off its pinned version.
 */
import { describe, it, expect, afterAll, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { sqlAsTenant, asTenant } from "./helpers/engine-harness.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "b0000000-1111-4000-8000-000000000001";

function token() {
  return signToken({ sub: randomUUID(), tid: TENANT, roles: ["workflow_admin"], sid: "s" }, SECRET);
}

const graph = {
  nodes: [
    { nodeKey: "start", name: "Start", nodeType: "start" },
    { nodeKey: "review", name: "Review", nodeType: "task", roleRef: "officer" },
    { nodeKey: "end", name: "End", nodeType: "end" },
  ],
  edges: [
    { fromNode: "start", toNode: "review" },
    { fromNode: "review", toNode: "end" },
  ],
};

let code = "";
afterEach(async () => {
  await sqlAsTenant(TENANT, sql`DELETE FROM workflow.instances WHERE tenant_id = ${TENANT}`);
  await sqlAsTenant(TENANT, sql`DELETE FROM workflow.definition_edges WHERE definition_id IN (SELECT id FROM workflow.definitions WHERE tenant_id = ${TENANT})`);
  await sqlAsTenant(TENANT, sql`DELETE FROM workflow.definition_nodes WHERE definition_id IN (SELECT id FROM workflow.definitions WHERE tenant_id = ${TENANT})`);
  await sqlAsTenant(TENANT, sql`DELETE FROM workflow.definitions WHERE tenant_id = ${TENANT}`);
});
afterAll(async () => { await sqlClient.end(); });

async function createAndDeploy(app: Awaited<ReturnType<typeof buildApp>>, defCode: string) {
  const c = await app.inject({ method: "POST", url: "/v1/workflow/definitions", headers: { authorization: `Bearer ${token()}` }, payload: { code: defCode, name: defCode, ...graph } });
  const id = c.json().data.id;
  await app.inject({ method: "POST", url: `/v1/workflow/definitions/${id}/deploy`, headers: { authorization: `Bearer ${token()}` } });
  return { id, version: c.json().data.version as number };
}

describe("CAP-030 in-flight version pinning", () => {
  it("keeps an in-flight instance on v1 after v2 is published, and rollback does not disturb it", async () => {
    const app = await buildApp();
    code = `pin-${Date.now()}`;
    const v1 = await createAndDeploy(app, code);

    // an in-flight instance pinned to v1
    const instId = randomUUID();
    const actor = randomUUID();
    await sqlAsTenant(TENANT, sql`INSERT INTO workflow.instances (id, tenant_id, name, status, definition_id, definition_version, current_node, created_by, updated_by)
      VALUES (${instId}, ${TENANT}, 'live case', 'active', ${v1.id}, 1, 'review', ${actor}, ${actor})`);

    // publish v2 (same code) and deploy it
    const v2 = await createAndDeploy(app, code);
    expect(v2.version).toBe(2);

    // in-flight impact: the running instance is still counted under v1's id
    const impact = await app.inject({ method: "GET", url: `/v1/workflow/definitions/code/${code}/in-flight`, headers: { authorization: `Bearer ${token()}` } });
    const rows = impact.json().data as Array<{ definitionId: string; version: number; count: number; status: string }>;
    const v1Row = rows.find((r) => r.definitionId === v1.id);
    expect(v1Row?.count).toBe(1); // pinned to v1
    expect(v1Row?.version).toBe(1);

    // the instance row itself still points at v1 (not silently re-bound to v2)
    const inst = await sqlAsTenant(TENANT, sql`SELECT definition_id, definition_version FROM workflow.instances WHERE id = ${instId}`);
    const pin = (inst as unknown as Array<{ definition_id: string; definition_version: number }>)[0]!;
    expect(pin.definition_id).toBe(v1.id);
    expect(pin.definition_version).toBe(1);

    // rollback to v1 → new instances would start on v1; in-flight case is untouched
    const rb = await app.inject({ method: "POST", url: `/v1/workflow/definitions/code/${code}/rollback`, headers: { authorization: `Bearer ${token()}` }, payload: { version: 1 } });
    expect(rb.statusCode).toBe(200);
    expect(rb.json().data.version).toBe(1);
    expect(rb.json().data.status).toBe("active");

    const inst2 = await sqlAsTenant(TENANT, sql`SELECT definition_id FROM workflow.instances WHERE id = ${instId}`);
    expect((inst2 as unknown as Array<{ definition_id: string }>)[0]!.definition_id).toBe(v1.id);
    await app.close();
  });
});

describe("CAP-030 version diff over the API", () => {
  it("diffs two versions of a code", async () => {
    const app = await buildApp();
    code = `diff-${Date.now()}`;
    await createAndDeploy(app, code);
    // v2 adds an audit node
    const g2 = {
      nodes: [...graph.nodes, { nodeKey: "audit", name: "Audit", nodeType: "task" }],
      edges: [{ fromNode: "start", toNode: "review" }, { fromNode: "review", toNode: "audit" }, { fromNode: "audit", toNode: "end" }],
    };
    const c2 = await app.inject({ method: "POST", url: "/v1/workflow/definitions", headers: { authorization: `Bearer ${token()}` }, payload: { code, name: code, ...g2 } });
    await app.inject({ method: "POST", url: `/v1/workflow/definitions/${c2.json().data.id}/deploy`, headers: { authorization: `Bearer ${token()}` } });

    const diff = await app.inject({ method: "GET", url: `/v1/workflow/definitions/code/${code}/diff?from=1&to=2`, headers: { authorization: `Bearer ${token()}` } });
    await app.close();
    expect(diff.statusCode).toBe(200);
    expect(diff.json().data.nodesAdded).toContain("audit");
  });
});
