/**
 * GAP-ADMIN-USERS-02: assigning a platform-authority role (super_admin/platform_admin)
 * requires platform authority even when the role carries no permissions.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-0000000000e1";
const ACTOR = "a0000000-0000-4000-8000-0000000000e1";
const TARGET = "a0000000-0000-4000-8000-0000000000e2";
const ROLE_SUPER = "bbbbbbbb-1111-4000-8000-0000000000e1";
const ROLE_PLAIN = "bbbbbbbb-1111-4000-8000-0000000000e2";

const hdr = (roles: string[]) => ({ authorization: `Bearer ${signToken({ sub: ACTOR, tid: TENANT, roles, sid: "s" } as never, SECRET)}` });

let app: FastifyInstance;
async function asTenant<T>(run: (sql: typeof sqlClient) => Promise<T>): Promise<T> {
  return sqlClient.begin(async (sql) => {
    await sql`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    return run(sql as typeof sqlClient);
  }) as Promise<T>;
}

beforeAll(async () => {
  const { buildApp } = await import("../src/app.js");
  app = await buildApp();
  await asTenant(async (sql) => {
    await sql`DELETE FROM rbac.roles WHERE tenant_id = ${TENANT}`;
    await sql`INSERT INTO rbac.roles (id, tenant_id, key, name, is_system, created_by, updated_by) VALUES
      (${ROLE_SUPER}, ${TENANT}, 'super_admin', 'Super Admin', true, ${ACTOR}, ${ACTOR}),
      (${ROLE_PLAIN}, ${TENANT}, 'auditor', 'Auditor', false, ${ACTOR}, ${ACTOR})`;
  });
});
afterAll(async () => {
  await asTenant(async (sql) => { await sql`DELETE FROM rbac.roles WHERE tenant_id = ${TENANT}`; });
  await app.close();
  await sqlClient.end();
});

const assign = (roleId: string, roles: string[]) =>
  app.inject({ method: "POST", url: `/identity/rbac/roles/${roleId}/assignments`, headers: hdr(roles), payload: { userId: TARGET } });

describe("assignRole reserved platform roles", () => {
  it("tenant_admin cannot assign the super_admin role (403) even though it has no permissions", async () => {
    expect((await assign(ROLE_SUPER, ["tenant_admin"])).statusCode).toBe(403);
  });
  it("platform staff can", async () => {
    expect((await assign(ROLE_SUPER, ["platform_admin"])).statusCode).toBe(202);
  });
  it("tenant_admin can still assign an ordinary role", async () => {
    expect((await assign(ROLE_PLAIN, ["tenant_admin"])).statusCode).toBe(202);
  });
});
