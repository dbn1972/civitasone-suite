/**
 * GAP-ADMIN-OPERATORS-05: Keycloak is touched only AFTER an approved change has
 * committed -- never when a request is made, rejected or refused -- and a failed
 * sync is recorded on the request without undoing the approval.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";

const kc = vi.hoisted(() => ({
  deactivateUser: vi.fn(async () => ({ ok: true })),
  enableUser: vi.fn(async () => ({ ok: true })),
  replaceRealmRoles: vi.fn(async () => ({ ok: true })),
}));
vi.mock("../src/shared/keycloak.js", async (orig) => ({
  ...(await orig<typeof import("../src/shared/keycloak.js")>()),
  isKeycloakEnabled: () => true,
  ...kc,
}));

import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerOperatorConsumers } from "../src/modules/operators/consumer.js";
import { COMMANDS } from "../src/topics.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const T = "eeeeeeee-0028-4000-8000-000000000001";
const A = "eeeeeeee-0028-4000-8000-000000000010";
const B = "eeeeeeee-0028-4000-8000-000000000011";
const P = "eeeeeeee-0028-4000-8000-000000000012";
const ROLE_S = "eeeeeeee-0028-4000-8000-000000000020";
const ROLE_P = "eeeeeeee-0028-4000-8000-000000000021";

let app: FastifyInstance;
const drain = () => (queue as unknown as { drain?: () => Promise<void> }).drain?.();
const hdr = (sub: string, roles: string[]) => ({ authorization: `Bearer ${signToken({ sub, tid: T, roles, sid: "sess-op-kc" }, SECRET, 3600)}` });

async function asTenant<R>(fn: (q: typeof sqlClient) => Promise<R>): Promise<R> {
  return (await sqlClient.begin(async (q) => {
    await q`SELECT set_config('app.tenant_id', ${T}, true)`;
    return fn(q as unknown as typeof sqlClient);
  })) as R;
}
async function seed() {
  await sqlClient`DELETE FROM _outbox.messages WHERE tenant_id = ${T}`;
  await asTenant(async (q) => {
    for (const t of ["users.operator_change_requests", "sessions.sessions", "rbac.role_assignment_history", "rbac.role_assignments", "rbac.roles", "users.users"]) {
      await q.unsafe(`DELETE FROM ${t} WHERE tenant_id = '${T}'`);
    }
    for (const [uid, name] of [[A, "Kc Asha"], [B, "Kc Bimal"], [P, "Kc Pavan"]] as const) {
      await q`INSERT INTO users.users (id, tenant_id, email, name, status, created_by, updated_by) VALUES (${uid}, ${T}, ${uid + "@dept.gov.in"}, ${name}, 'active', ${A}, ${A})`;
    }
    await q`INSERT INTO rbac.roles (id, tenant_id, key, name, created_by, updated_by) VALUES (${ROLE_S}, ${T}, 'super_admin', 'Super Admin', ${A}, ${A})`;
    await q`INSERT INTO rbac.roles (id, tenant_id, key, name, created_by, updated_by) VALUES (${ROLE_P}, ${T}, 'platform_admin', 'Platform Admin', ${A}, ${A})`;
    for (const [uid, rid] of [[A, ROLE_S], [B, ROLE_S], [P, ROLE_P]] as const) {
      await q`INSERT INTO rbac.role_assignments (tenant_id, role_id, user_id, created_by, updated_by) VALUES (${T}, ${rid}, ${uid}, ${A}, ${A})`;
    }
  });
}
const kcSync = (rid: string) => asTenant(async (q) => (await q<Array<{ kc_sync: string; status: string }>>`SELECT kc_sync, status FROM users.operator_change_requests WHERE id = ${rid}`)[0]!);

async function post(url: string, headers: Record<string, string>, payload: Record<string, unknown>) {
  const r = await app.inject({ method: "POST", url, headers, payload });
  await drain();
  return r;
}

beforeAll(async () => { registerOperatorConsumers(queue); await queue.start(); app = await buildApp(); });
beforeEach(async () => { vi.clearAllMocks(); kc.deactivateUser.mockResolvedValue({ ok: true }); await seed(); });
afterAll(async () => { await seed(); await asTenant(async (q) => { await q.unsafe(`DELETE FROM users.users WHERE tenant_id = '${T}'`); }); await app.close(); await queue.stop(); await sqlClient.end(); });

describe("keycloak side effects of an operator change", () => {
  it("are not triggered by a request, a rejection, or a refused approval", async () => {
    const r1 = (await post(`/identity/operators/${B}/requests`, hdr(P, ["platform_admin"]), { kind: "suspend", reason: "no side effect yet" })).json().id;
    const calls = () => kc.deactivateUser.mock.calls.length + kc.enableUser.mock.calls.length + kc.replaceRealmRoles.mock.calls.length;
    expect(calls()).toBe(0);
    await post(`/identity/operators/requests/${r1}/reject`, hdr(A, ["super_admin"]), { note: "not now" });
    expect(calls()).toBe(0);
    const r2 = (await post(`/identity/operators/${B}/requests`, hdr(P, ["platform_admin"]), { kind: "suspend", reason: "second request" })).json().id;
    // approval by the maker is refused: still no Keycloak call
    await queue.publish(COMMANDS.operatorDecide, { messageId: randomUUID(), type: COMMANDS.operatorDecide, tenantId: T, actorId: P, correlationId: randomUUID(), schemaVersion: "1.0", payload: { requestId: r2, decision: "approve" } });
    await drain();
    expect(calls()).toBe(0);
  });

  it("suspend: the realm user is disabled after approval and the sync is recorded", async () => {
    const rid = (await post(`/identity/operators/${B}/requests`, hdr(P, ["platform_admin"]), { kind: "suspend", reason: "approved suspension" })).json().id;
    await post(`/identity/operators/requests/${rid}/approve`, hdr(A, ["super_admin"]), {});
    expect(kc.deactivateUser).toHaveBeenCalledWith(T, `${B}@dept.gov.in`, expect.anything());
    expect(await kcSync(rid)).toMatchObject({ status: "approved", kc_sync: "ok" });
  });

  it("reactivate: the realm user is re-enabled", async () => {
    await asTenant(async (q) => { await q`UPDATE users.users SET status = 'suspended' WHERE id = ${P}`; });
    const rid = (await post(`/identity/operators/${P}/requests`, hdr(A, ["super_admin"]), { kind: "reactivate", reason: "back from leave" })).json().id;
    await post(`/identity/operators/requests/${rid}/approve`, hdr(B, ["super_admin"]), {});
    expect(kc.enableUser).toHaveBeenCalledWith(T, `${P}@dept.gov.in`, expect.anything());
    expect((await kcSync(rid)).kc_sync).toBe("ok");
  });

  it("role change: the old realm role is swapped for the new one", async () => {
    const rid = (await post(`/identity/operators/${P}/requests`, hdr(A, ["super_admin"]), { kind: "role_change", reason: "promotion", toRole: "super_admin" })).json().id;
    await post(`/identity/operators/requests/${rid}/approve`, hdr(B, ["super_admin"]), {});
    expect(kc.replaceRealmRoles).toHaveBeenCalledWith({ tenantId: T, email: `${P}@dept.gov.in` }, ["platform_admin"], ["super_admin"], expect.anything());
  });

  it("a failed Keycloak sync is recorded as failed and the approval stands", async () => {
    kc.deactivateUser.mockResolvedValue({ ok: false });
    const rid = (await post(`/identity/operators/${B}/requests`, hdr(P, ["platform_admin"]), { kind: "suspend", reason: "kc is down" })).json().id;
    await post(`/identity/operators/requests/${rid}/approve`, hdr(A, ["super_admin"]), {});
    expect(await kcSync(rid)).toMatchObject({ status: "approved", kc_sync: "failed" });
    const st = await asTenant(async (q) => (await q<Array<{ status: string }>>`SELECT status FROM users.users WHERE id = ${B}`)[0]!.status);
    expect(st).toBe("suspended");
  });
});
