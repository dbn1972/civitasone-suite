/** GAP-ADMIN-USERS-03: GET /v1/admin/users forwards search/status/paging and relays the real total. */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { sqlClient } from "../src/shared/db.js";

const { buildApp } = await import("../src/app.js");
const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const T = "5e7c0000-0000-4000-8000-0000000000a1";
const auth = (roles: string[]) => ({ authorization: `Bearer ${signToken({ sub: "5e7cacc0-0000-4000-8000-0000000000a1", tid: T, roles, sid: "sess-us" }, SECRET, 3600)}` });
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

let app: FastifyInstance;
beforeAll(async () => { app = await buildApp(); });
afterEach(() => { vi.unstubAllGlobals(); });
afterAll(async () => { await app.close(); await sqlClient.end(); });

describe("GET /v1/admin/users", () => {
  it("passes q, status, limit and offset to identity-service search and relays total + counts", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      calls.push(url);
      return json(200, { rows: [{ id: "u1", name: "A", email: "a@gov.in", status: "suspended" }], total: 1240, counts: { active: 1100, suspended: 100, locked: 0, deactivated: 40 } });
    }));
    const res = await app.inject({ method: "GET", url: "/v1/admin/users?q=rao%20k&status=suspended&limit=25&offset=50", headers: auth(["tenant_admin"]) });
    expect(res.statusCode).toBe(200);
    const u = new URL(calls[0]!);
    expect(u.pathname).toBe("/identity/users/search");
    expect(Object.fromEntries(u.searchParams)).toEqual({ tenantId: T, q: "rao k", status: "suspended", limit: "25", offset: "50" });
    const body = res.json();
    expect(body.data).toHaveLength(1);
    expect(body.meta).toMatchObject({ page: 3, pageSize: 25, total: 1240, counts: { active: 1100, suspended: 100, locked: 0, deactivated: 40 } });
  });

  it("still reads a bare array from an older identity-service (total = rows returned)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(200, [{ id: "u1" }, { id: "u2" }])));
    const res = await app.inject({ method: "GET", url: "/v1/admin/users", headers: auth(["tenant_admin"]) });
    expect(res.json().meta.total).toBe(2);
  });

  it("rejects a bad status or an oversize limit before calling upstream, and keeps the role gate", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    expect((await app.inject({ method: "GET", url: "/v1/admin/users?status=banished", headers: auth(["tenant_admin"]) })).statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: "/v1/admin/users?limit=999", headers: auth(["tenant_admin"]) })).statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: "/v1/admin/users", headers: auth(["employee"]) })).statusCode).toBe(403);
    expect(f).not.toHaveBeenCalled();
  });
});
