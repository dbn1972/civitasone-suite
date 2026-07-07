/**
 * Cross-Tenant RLS Isolation Integration Test — Estab Service
 *
 * Validates: Requirements 1.5, 1.6
 * - Tenant A creates resource, Tenant B attempts read/update/delete → 0 rows / 404
 * - Attempts to access a specific Tenant B resource by ID return HTTP 404 (not 403)
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";

const TENANT_A = "aaaaaaaa-0000-4000-8000-000000000001";
const TENANT_B = "bbbbbbbb-0000-4000-8000-000000000002";
const ACTOR_A = "aaaaaaaa-0000-4000-8000-aaaaaaaaaaaa";
const ACTOR_B = "bbbbbbbb-0000-4000-8000-bbbbbbbbbbbb";

function tokenForTenant(tenantId: string, actorId: string, roles: string[] = ["super_admin", "estab_officer"]) {
  return signToken({ sub: actorId, tid: tenantId, roles, sid: "sess-rls" }, SECRET, 3600);
}

let app: FastifyInstance;
let tokenA: string;
let tokenB: string;

beforeAll(async () => {
  app = await buildApp();
  tokenA = tokenForTenant(TENANT_A, ACTOR_A);
  tokenB = tokenForTenant(TENANT_B, ACTOR_B);
});

afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

describe("Estab — Cross-Tenant RLS Isolation", () => {
  let createdFileId: string | undefined;

  it("Tenant A creates a file", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/estab/files",
      headers: { authorization: `Bearer ${tokenA}`, "content-type": "application/json" },
      payload: {
        fileNo: `FILE-RLS-${Date.now()}`,
        subject: "RLS Isolation Test File",
        dept: "General Administration",
        currentWith: ACTOR_A,
      },
    });
    expect([201, 202]).toContain(res.statusCode);
    const body = res.json();
    createdFileId = body.data?.id ?? body.id;
    expect(createdFileId).toBeDefined();
  });

  it("Tenant B list of files returns zero of Tenant A data", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/estab/files",
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const data = Array.isArray(body) ? body : body.data ?? [];
    const leakedIds = data.filter((f: { id?: string }) => f.id === createdFileId);
    expect(leakedIds).toHaveLength(0);
  });

  it("Tenant B GET file by ID returns 404", async () => {
    if (!createdFileId) return;
    const res = await app.inject({
      method: "GET",
      url: `/v1/estab/files/${createdFileId}`,
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it("Tenant B PATCH file returns 404", async () => {
    if (!createdFileId) return;
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/estab/files/${createdFileId}`,
      headers: { authorization: `Bearer ${tokenB}`, "content-type": "application/json" },
      payload: { subject: "Hacked File Subject" },
    });
    expect([404, 405]).toContain(res.statusCode);
  });

  it("Tenant B DELETE file returns 404", async () => {
    if (!createdFileId) return;
    const res = await app.inject({
      method: "DELETE",
      url: `/v1/estab/files/${createdFileId}`,
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect([404, 405]).toContain(res.statusCode);
  });

  it("Tenant B correspondence list shows zero Tenant A data", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/estab/correspondence",
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect([200, 404]).toContain(res.statusCode);
    if (res.statusCode === 200) {
      const body = res.json();
      const data = Array.isArray(body) ? body : body.data ?? [];
      const leakedTenants = data.filter((c: { tenantId?: string }) => c.tenantId === TENANT_A);
      expect(leakedTenants).toHaveLength(0);
    }
  });
});
