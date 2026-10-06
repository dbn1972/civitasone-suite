/**
 * ROLES-03 (review round 1): the RBAC change reason sent by the web matrix is
 * validated, published as a command and written to the audit trail by a consumer.
 * Only the DB layer and upstream fetch are mocked.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { signToken } from "@civitasone/auth";
import type { Queue } from "@civitasone/queue";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "bbbbbbbb-cccc-4000-8000-0000000000e2";
const ROLE = "44444444-4444-4444-8444-4444444444aa";
const tok = (roles: string[]) => signToken({ sub: "rbac-user", tid: TENANT, roles, sid: "sess-rbac" }, SECRET, 3600);

vi.mock("../src/shared/db.js", () => {
  const sqlClientFn = (..._a: unknown[]) => Promise.resolve([]);
  sqlClientFn.end = vi.fn(async () => {});
  sqlClientFn.unsafe = vi.fn((..._a: unknown[]) => Promise.resolve([]));
  sqlClientFn.begin = vi.fn(async (fn: (tx: typeof sqlClientFn) => Promise<unknown>) => fn(sqlClientFn));
  return {
    db: { transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb({}) },
    sqlClient: sqlClientFn,
    scopedRead: async () => [],
  };
});

const enqueueMock = vi.fn(async () => {});
vi.mock("../src/shared/outbox.js", () => ({
  markProcessed: vi.fn(async () => true),
  enqueue: (...a: unknown[]) => (enqueueMock as (...x: unknown[]) => Promise<void>)(...a),
}));

import { buildApp } from "../src/app.js";
import { queue } from "../src/shared/infra.js";
import { sqlClient } from "../src/shared/db.js";
import { registerRolePermissionAuditConsumers } from "../src/modules/role-permissions-audit/consumer.js";
import { COMMANDS } from "../src/topics.js";

let app: FastifyInstance;
beforeAll(async () => { app = await buildApp(); });
afterAll(async () => { await app.close(); await sqlClient.end(); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const json = (status: number, body: unknown) => ({ ok: status < 400, status, text: async () => JSON.stringify(body), json: async () => body, headers: new Headers({ "content-type": "application/json" }) });

function stubIdentity() {
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: { method: string }) => {
    if (url.endsWith(`/identity/rbac/roles/${ROLE}`)) return json(200, { id: ROLE, permissions: ["finance.read"] });
    if (url.includes("/identity/rbac/permissions")) return json(200, [{ id: "p1", key: "finance.read" }, { id: "p2", key: "finance.write" }]);
    return json(202, { id: ROLE, status: "accepted" });
  }));
}
const patch = (payload: unknown) =>
  app.inject({ method: "PATCH", url: `/v1/admin/roles/${ROLE}/permissions`, headers: { authorization: `Bearer ${tok(["platform_admin"])}` }, payload: payload as object });

describe("PATCH /v1/admin/roles/:id/permissions reason", () => {
  it("accepts a reason and publishes it on the audit command", async () => {
    stubIdentity();
    const spy = vi.spyOn(queue, "publish");
    const r = await patch({ permissionKeys: ["finance.write"], reason: "quarterly access review" });
    expect(r.statusCode).toBe(202);
    const call = spy.mock.calls.find((c) => c[0] === COMMANDS.rolePermissionsChanged);
    expect(call).toBeTruthy();
    expect((call![1] as { payload: Record<string, unknown> }).payload).toMatchObject({
      roleId: ROLE, granted: ["finance.write"], revoked: ["finance.read"], reason: "quarterly access review",
    });
  });

  it("rejects a too-short or over-long reason with 400", async () => {
    stubIdentity();
    expect((await patch({ permissionKeys: ["finance.write"], reason: "x" })).statusCode).toBe(400);
    expect((await patch({ permissionKeys: ["finance.write"], reason: "y".repeat(501) })).statusCode).toBe(400);
  });
});

describe("role-permissions audit consumer", () => {
  it("writes an audit outbox row carrying the reason", async () => {
    enqueueMock.mockClear();
    const handlers = new Map<string, (msg: unknown) => Promise<void>>();
    const q = { subscribe: (t: string, h: (msg: unknown) => Promise<void>) => { handlers.set(t, h); } } as unknown as Queue;
    registerRolePermissionAuditConsumers(q);
    await handlers.get(COMMANDS.rolePermissionsChanged)!({
      messageId: "m-rbac-1", type: COMMANDS.rolePermissionsChanged, tenantId: TENANT, actorId: "a1", correlationId: "c1", schemaVersion: "1.0",
      payload: { roleId: ROLE, granted: ["finance.write"], revoked: [], reason: "quarterly access review" },
    });
    const arg = enqueueMock.mock.calls[0] as unknown as [unknown, { topic: string; payload: Record<string, unknown> }];
    expect(arg[1].topic).toBe("audit.event.record");
    expect(arg[1].payload).toMatchObject({ resourceType: "role_permissions", reason: "quarterly access review" });
  });
});
