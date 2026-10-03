/**
 * GAP-ADMIN-ORG-03: POST /v1/admin/org-hierarchy/:id/deactivate forwards to
 * tenant-service with the CALLER's bearer token (never the internal service
 * seam), requires a reason, is gated to admin roles, and relays tenant-service's
 * 409 (active children) as-is.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "bbbbbbbb-0046-4000-8000-000000000001";
const hdr = (roles: string[]) => ({ authorization: `Bearer ${signToken({ sub: "u-org-deact", tid: TENANT, roles, sid: "sess-org-deact" }, SECRET, 3600)}` });
const res = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) }) as Response;

let app: FastifyInstance;
beforeAll(async () => { app = await buildApp(); });
afterAll(async () => { await app.close(); await sqlClient.end(); });
afterEach(() => vi.unstubAllGlobals());

describe("POST /v1/admin/org-hierarchy/:id/deactivate", () => {
  it("forwards to tenant-service with the caller's token and the reason", async () => {
    const id = randomUUID();
    const fetchMock = vi.fn(async (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => {
      expect(url).toContain(`/v1/org/hierarchy/${id}/deactivate`);
      expect(init.method).toBe("POST");
      expect(init.headers.authorization).toMatch(/^Bearer /);
      expect(init.headers["x-internal"]).toBeUndefined();
      expect(JSON.parse(init.body ?? "{}")).toEqual({ reason: "Merged into Accounts" });
      return res(202, { data: { id, status: "accepted" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    const r = await app.inject({ method: "POST", url: `/v1/admin/org-hierarchy/${id}/deactivate`, headers: hdr(["tenant_admin"]), payload: { reason: "Merged into Accounts" } });
    expect(r.statusCode).toBe(202);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("400 without a reason, and never calls tenant-service", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const r = await app.inject({ method: "POST", url: `/v1/admin/org-hierarchy/${randomUUID()}/deactivate`, headers: hdr(["tenant_admin"]), payload: { reason: "x" } });
    expect(r.statusCode).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("403 for a non-admin", async () => {
    const r = await app.inject({ method: "POST", url: `/v1/admin/org-hierarchy/${randomUUID()}/deactivate`, headers: hdr(["employee"]), payload: { reason: "no access here" } });
    expect(r.statusCode).toBe(403);
  });

  it("relays tenant-service's 409 HAS_ACTIVE_CHILDREN", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => res(409, { error: { code: "HAS_ACTIVE_CHILDREN", message: "Org unit has 2 active child units; move or deactivate them first" } })));
    const r = await app.inject({ method: "POST", url: `/v1/admin/org-hierarchy/${randomUUID()}/deactivate`, headers: hdr(["tenant_admin"]), payload: { reason: "closing it down" } });
    expect(r.statusCode).toBe(409);
    expect(r.body).toContain("HAS_ACTIVE_CHILDREN");
  });
});
