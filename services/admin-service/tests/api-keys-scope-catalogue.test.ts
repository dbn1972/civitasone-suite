/**
 * GAP-TENANT-ADMIN-API-KEYS-03 / -04 (real DB, real Fastify via app.inject):
 *  - GET /v1/admin/api-keys/scopes returns exactly what the caller may grant
 *    (tenant_admin: the confined allow-list; platform_admin: the full catalogue)
 *  - the create route and the catalogue agree: every offered scope is accepted,
 *    anything else is 403 SCOPE_FORBIDDEN
 *  - an expiresAt in the past is a 400, not a stored dead key
 *  - a created key shows up in the SAME list the page reads, with its scopes
 *    and chosen expiry (read path and write path are one store)
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { db, sqlClient } from "../src/shared/db.js";
import { adminApiKeys } from "../src/modules/api-keys/schema.js";
import { registerApiKeyConsumers } from "../src/modules/api-keys/consumer.js";
import { queue } from "../src/shared/infra.js";
import { tenantScoped } from "../src/shared/tenant-queue.js";

const { buildApp } = await import("../src/app.js");

registerApiKeyConsumers(tenantScoped(queue));

const SECRET = process.env.JWT_SECRET as string;
const T = randomUUID();
const ACTOR = randomUUID();
const bearer = (roles: string[]) => ({
  authorization: `Bearer ${signToken({ sub: ACTOR, roles, tid: T } as never, SECRET)}`,
});

let app: FastifyInstance;
beforeAll(async () => { app = await buildApp(); });
afterAll(async () => {
  await runWithTenant(T, () => db.transaction((tx) => tx.delete(adminApiKeys).where(eq(adminApiKeys.tenantId, T))));
  await app.close();
  await sqlClient.end();
});

describe("api-keys scope catalogue", () => {
  it("tenant_admin is offered only the confined allow-list", async () => {
    const r = await app.inject({ method: "GET", url: "/v1/admin/api-keys/scopes", headers: bearer(["tenant_admin"]) });
    expect(r.statusCode).toBe(200);
    const { data } = r.json() as { data: string[] };
    expect(data).toEqual(["api-keys:read", "backup:read", "config:read", "config:write", "tenant:read"]);
  });

  it("platform_admin is offered a superset", async () => {
    const r = await app.inject({ method: "GET", url: "/v1/admin/api-keys/scopes", headers: bearer(["platform_admin"]) });
    const { data } = r.json() as { data: string[] };
    expect(data).toContain("finance:read");
    expect(data).toContain("config:read");
  });

  it("a non-admin gets 403 on the catalogue", async () => {
    const r = await app.inject({ method: "GET", url: "/v1/admin/api-keys/scopes", headers: bearer(["employee"]) });
    expect(r.statusCode).toBe(403);
  });

  it("every scope offered to tenant_admin is accepted by create; a platform-only scope is 403", async () => {
    const offered = ((await app.inject({ method: "GET", url: "/v1/admin/api-keys/scopes", headers: bearer(["tenant_admin"]) })).json() as { data: string[] }).data;
    const ok = await app.inject({
      method: "POST", url: "/v1/admin/api-keys", headers: bearer(["tenant_admin"]),
      payload: { keyName: "catalogue-ok", scopes: offered, expiresAt: new Date(Date.now() + 30 * 864e5).toISOString() },
    });
    expect(ok.statusCode).toBe(202);
    const denied = await app.inject({
      method: "POST", url: "/v1/admin/api-keys", headers: bearer(["tenant_admin"]),
      payload: { keyName: "catalogue-denied", scopes: ["finance:read"] },
    });
    expect(denied.statusCode).toBe(403);
    expect((denied.json() as { code: string }).code).toBe("SCOPE_FORBIDDEN");
  });

  it("an expiresAt in the past is rejected with 400", async () => {
    const r = await app.inject({
      method: "POST", url: "/v1/admin/api-keys", headers: bearer(["tenant_admin"]),
      payload: { keyName: "dead-on-arrival", scopes: ["config:read"], expiresAt: new Date(Date.now() - 864e5).toISOString() },
    });
    expect(r.statusCode).toBe(400);
  });

  it("a created key appears in the list the page reads, with the chosen scopes and expiry", async () => {
    const expiresAt = new Date(Date.now() + 90 * 864e5).toISOString();
    const created = await app.inject({
      method: "POST", url: "/v1/admin/api-keys", headers: bearer(["tenant_admin"]),
      payload: { keyName: "listed-key", scopes: ["config:read"], expiresAt },
    });
    expect(created.statusCode).toBe(202);
    const { id } = created.json() as { id: string };
    await (queue as unknown as { drain(): Promise<void> }).drain();
    const list = await app.inject({ method: "GET", url: "/v1/admin/api-keys?limit=100", headers: bearer(["tenant_admin"]) });
    const rows = (list.json() as unknown) as Array<Record<string, unknown>> | { data: Array<Record<string, unknown>> };
    const arr = Array.isArray(rows) ? rows : rows.data;
    const row = arr.find((k) => k.id === id);
    expect(row, "created key must be listed").toBeTruthy();
    expect(row!.scopes).toEqual(["config:read"]);
    expect(new Date(String(row!.expiresAt)).toISOString()).toBe(expiresAt);
  });
});
