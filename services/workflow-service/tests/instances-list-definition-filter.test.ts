/**
 * GAP2-WORKFLOW-DEFINITIONS-DETAIL-01 — the instances LIST endpoint must honor
 * an optional ?definitionId filter so a definition's "View instances" link
 * shows only that definition's cases. Previously the list route parsed only
 * limit/offset and returned every tenant instance regardless of the parameter,
 * so the control presented as a per-definition filter but silently showed an
 * unfiltered list.
 *
 * DB-backed, following tests/instances-list-enriched.test.ts's harness exactly.
 */
import { describe, it, expect, afterAll, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { instances } from "../src/modules/instances/schema.js";
import { definitions } from "../src/modules/definitions/schema.js";
import { asTenant, cleanup } from "./helpers/engine-harness.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";

function makeToken(tenantId: string, roles: string[] = ["workflow_user"], sub = "user-f01") {
  return signToken({ sub, tid: tenantId, roles, sid: "sess-deffilter" }, SECRET);
}

const tenants: string[] = [];
function newTenant(): string { const t = randomUUID(); tenants.push(t); return t; }

afterEach(async () => {
  if (tenants.length) { await cleanup(...tenants); tenants.length = 0; }
});
afterAll(async () => { await sqlClient.end(); });

async function seedDefinition(tenantId: string, actorId: string, code: string, name: string): Promise<string> {
  const id = randomUUID();
  await asTenant(tenantId, () => db.transaction(async (tx) => {
    await tx.insert(definitions).values({
      id, tenantId, code, name, version: 1, status: "active", isTemplate: false,
      createdBy: actorId, updatedBy: actorId,
    });
  }));
  return id;
}

async function seedInstance(tenantId: string, actorId: string, name: string, definitionId: string): Promise<string> {
  const id = randomUUID();
  await asTenant(tenantId, () => db.transaction(async (tx) => {
    await tx.insert(instances).values({
      id, tenantId, name, status: "active",
      definitionId, definitionVersion: 1,
      createdBy: actorId, updatedBy: actorId, version: 1,
    });
  }));
  return id;
}

describe("GET /v1/workflow/instances?definitionId= — GAP2-WORKFLOW-DEFINITIONS-DETAIL-01", () => {
  it("returns only instances for the requested definition (not the whole tenant)", async () => {
    const tenantId = newTenant();
    const actorId = randomUUID();
    const defA = await seedDefinition(tenantId, actorId, `a_${randomUUID().slice(0, 6)}`, "Def A");
    const defB = await seedDefinition(tenantId, actorId, `b_${randomUUID().slice(0, 6)}`, "Def B");
    const a1 = await seedInstance(tenantId, actorId, "A-1", defA);
    const a2 = await seedInstance(tenantId, actorId, "A-2", defA);
    const b1 = await seedInstance(tenantId, actorId, "B-1", defB);

    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/workflow/instances?definitionId=${defA}`,
      headers: { authorization: `Bearer ${makeToken(tenantId)}` },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const ids = (res.json().data as Array<{ id: string }>).map((r) => r.id).sort();
    expect(ids).toEqual([a1, a2].sort());
    expect(ids).not.toContain(b1);
  });

  it("returns all tenant instances when no definitionId is given", async () => {
    const tenantId = newTenant();
    const actorId = randomUUID();
    const defA = await seedDefinition(tenantId, actorId, `a_${randomUUID().slice(0, 6)}`, "Def A");
    const defB = await seedDefinition(tenantId, actorId, `b_${randomUUID().slice(0, 6)}`, "Def B");
    const a1 = await seedInstance(tenantId, actorId, "A-1", defA);
    const b1 = await seedInstance(tenantId, actorId, "B-1", defB);

    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/workflow/instances`,
      headers: { authorization: `Bearer ${makeToken(tenantId)}` },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const ids = (res.json().data as Array<{ id: string }>).map((r) => r.id);
    expect(ids).toContain(a1);
    expect(ids).toContain(b1);
  });
});
