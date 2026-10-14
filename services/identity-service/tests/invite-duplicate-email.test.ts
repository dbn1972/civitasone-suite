/**
 * GAP-TENANT-ADMIN-USERS-07: inviting an email that is already in the tenant's
 * directory is refused with 409 DUPLICATE_EMAIL (case-insensitive) instead of a
 * 202 whose consumer then fails on the unique index. A different tenant may
 * still hold the same email. Real Postgres, real Fastify.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const T1 = "d9000000-0000-4000-8000-0000000000a1";
const T2 = "d9000000-0000-4000-8000-0000000000a2";
const ADMIN = "d9000000-0000-4000-8000-0000000000ad";
const EXISTING = "d9000000-0000-4000-8000-0000000000e1";

let app: FastifyInstance;
const hdr = (tid: string, roles = ["tenant_admin"]) => ({ authorization: `Bearer ${signToken({ sub: ADMIN, tid, roles, sid: "s-dup" }, SECRET, 3600)}` });

async function asTenant<R>(tenant: string, fn: (q: typeof sqlClient) => Promise<R>): Promise<R> {
  return (await sqlClient.begin(async (q) => {
    await q`SELECT set_config('app.tenant_id', ${tenant}, true)`;
    return fn(q as unknown as typeof sqlClient);
  })) as R;
}
async function wipe() {
  await asTenant(T1, async (q) => { await q`DELETE FROM users.users WHERE tenant_id = ${T1}`; });
  await asTenant(T2, async (q) => { await q`DELETE FROM users.users WHERE tenant_id = ${T2}`; });
}

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  await wipe();
  await asTenant(T1, async (q) => {
    await q`INSERT INTO users.users (id, tenant_id, email, name, status, created_by, updated_by) VALUES (${EXISTING}, ${T1}, 'asha@dept.gov.in', 'Asha', 'active', ${ADMIN}, ${ADMIN})`;
  });
});
afterAll(async () => { await wipe(); await app.close(); });

describe("POST /identity/users — duplicate email", () => {
  it("409 DUPLICATE_EMAIL for an exact duplicate", async () => {
    const res = await app.inject({ method: "POST", url: "/identity/users", headers: hdr(T1), payload: { email: "asha@dept.gov.in", name: "Asha Again" } });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("DUPLICATE_EMAIL");
  });

  it("409 for a differently-cased duplicate", async () => {
    const res = await app.inject({ method: "POST", url: "/identity/users", headers: hdr(T1), payload: { email: "ASHA@Dept.Gov.In", name: "Asha Upper" } });
    expect(res.statusCode).toBe(409);
  });

  it("202 for a new email, and for the same email in a DIFFERENT tenant", async () => {
    const fresh = await app.inject({ method: "POST", url: "/identity/users", headers: hdr(T1), payload: { email: "ravi@dept.gov.in", name: "Ravi" } });
    expect(fresh.statusCode).toBe(202);
    const otherTenant = await app.inject({ method: "POST", url: "/identity/users", headers: hdr(T2), payload: { email: "asha@dept.gov.in", name: "Asha T2" } });
    expect(otherTenant.statusCode).toBe(202);
  });
});
