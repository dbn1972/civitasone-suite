/**
 * GAP-TENANT-ADMIN-ROLES-06 / -ROLES-DETAIL-06 (real DB, real Fastify, real
 * consumers):
 *  - creating or renaming a role onto an existing name (any case) is a
 *    synchronous 409 ROLE_NAME_TAKEN, not a 202 that fails later in the consumer
 *  - a role/permission written for tenant A is invisible to tenant B (404)
 *  - setting a permission cell that already exists CHANGES its effect (the
 *    permission grid flips allow -> deny); before, the repeat was silently dropped
 *    (onConflictDoNothing) while the UI reported "saved"
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerRoleConsumers } from "../src/modules/roles/consumer.js";

const SECRET = process.env.JWT_SECRET as string;
const A = randomUUID();
const B = randomUUID();
const ACTOR = randomUUID();
const hdr = (tid: string, roles = ["tenant_admin"]) => ({
  authorization: `Bearer ${signToken({ sub: ACTOR, tid, roles, sid: "s-roles" }, SECRET, 3600)}`,
  "content-type": "application/json",
});
const drain = () => (queue as unknown as { drain(): Promise<void> }).drain();

let app: FastifyInstance;
beforeAll(async () => {
  registerRoleConsumers(queue);
  await queue.start();
  app = await buildApp();
});
afterAll(async () => { await app.close(); await sqlClient.end(); });

async function createRole(tid: string, name: string): Promise<string> {
  const r = await app.inject({ method: "POST", url: "/policy/roles", headers: hdr(tid), payload: { name } });
  expect(r.statusCode).toBe(202);
  await drain();
  return (r.json() as { id: string }).id;
}
async function perms(tid: string, roleId: string) {
  const r = await app.inject({ method: "GET", url: `/policy/roles/${roleId}/permissions`, headers: hdr(tid) });
  expect(r.statusCode).toBe(200);
  return (r.json() as { data: Array<{ resource: string; action: string; effect: string }> }).data;
}

describe("role name uniqueness is answered synchronously", () => {
  it("create: a duplicate (same case) is 409 ROLE_NAME_TAKEN and no second row is written", async () => {
    await createRole(A, "Auditor");
    const dup = await app.inject({ method: "POST", url: "/policy/roles", headers: hdr(A), payload: { name: "Auditor" } });
    expect(dup.statusCode).toBe(409);
    expect((dup.json() as { code: string }).code).toBe("ROLE_NAME_TAKEN");
    await drain();
    const list = await app.inject({ method: "GET", url: "/policy/roles", headers: hdr(A) });
    const names = ((list.json() as { data?: Array<{ name: string }> }).data ?? (list.json() as Array<{ name: string }>)).map((r) => r.name);
    expect(names.filter((n) => n === "Auditor")).toHaveLength(1);
  });

  it("create: a different case or surrounding spaces is still a duplicate", async () => {
    const dup = await app.inject({ method: "POST", url: "/policy/roles", headers: hdr(A), payload: { name: "  AUDITOR " } });
    expect(dup.statusCode).toBe(409);
  });

  it("rename: onto another role's name is 409; to its own name is allowed", async () => {
    const other = await createRole(A, "Reviewer");
    const clash = await app.inject({ method: "PATCH", url: `/policy/roles/${other}`, headers: hdr(A), payload: { name: "auditor" } });
    expect(clash.statusCode).toBe(409);
    const same = await app.inject({ method: "PATCH", url: `/policy/roles/${other}`, headers: hdr(A), payload: { name: "Reviewer", description: "x" } });
    expect(same.statusCode).toBe(202);
  });

  it("the same name in ANOTHER tenant is fine (uniqueness is per tenant)", async () => {
    const r = await app.inject({ method: "POST", url: "/policy/roles", headers: hdr(B), payload: { name: "Auditor" } });
    expect(r.statusCode).toBe(202);
    await drain();
  });
});

describe("permission cell upsert", () => {
  it("a repeat POST for an existing (resource, action) changes the effect instead of being dropped", async () => {
    const role = await createRole(A, `Grid-${randomUUID().slice(0, 8)}`);
    const post = (effect: "allow" | "deny") => app.inject({
      method: "POST", url: `/policy/roles/${role}/permissions`, headers: hdr(A),
      payload: { resource: "finance", action: "read", effect, reason: "grid change" },
    });
    expect((await post("allow")).statusCode).toBe(202);
    await drain();
    expect(await perms(A, role)).toEqual([expect.objectContaining({ resource: "finance", action: "read", effect: "allow" })]);

    expect((await post("deny")).statusCode).toBe(202);
    await drain();
    const after = await perms(A, role);
    expect(after).toHaveLength(1);
    expect(after[0]!.effect).toBe("deny");
  });

  it("a resource containing a colon round-trips unchanged", async () => {
    const role = await createRole(A, `Colon-${randomUUID().slice(0, 8)}`);
    const r = await app.inject({
      method: "POST", url: `/policy/roles/${role}/permissions`, headers: hdr(A),
      payload: { resource: "module:sub", action: "read", effect: "allow" },
    });
    expect(r.statusCode).toBe(202);
    await drain();
    expect(await perms(A, role)).toEqual([expect.objectContaining({ resource: "module:sub", action: "read" })]);
  });

  it("tenant B cannot see tenant A's role or its permissions", async () => {
    const role = await createRole(A, `Private-${randomUUID().slice(0, 8)}`);
    expect((await app.inject({ method: "GET", url: `/policy/roles/${role}`, headers: hdr(B) })).statusCode).toBe(404);
    const r = await app.inject({ method: "GET", url: `/policy/roles/${role}/permissions`, headers: hdr(B) });
    expect(r.statusCode).toBe(404);
  });
});
