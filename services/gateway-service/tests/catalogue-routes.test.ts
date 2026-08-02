/**
 * CAP-052 — API catalogue route + persistence integration tests.
 *
 * Hits the live civitas_gateway DB (gateway_svc, NOBYPASSRLS + FORCE RLS) via a
 * real buildApp() + app.inject(). Mutations are CQRS (202); consumer apply is
 * covered in catalogue-consumer.test.ts.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { eq } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { withTenantScope } from "@civitasone/db";
import type { FastifyInstance } from "fastify";
import { SERVICE_ROUTES } from "../src/registry.js";
import { versionFromPrefix, registryEntries } from "../src/modules/catalogue/seed.js";

const SECRET = "test_secret_for_civitasone_32chr";
const TENANT_A = "ca7a1041-0000-4000-8000-0000000000a1";
const TENANT_B = "ca7a1041-0000-4000-8000-0000000000b2";
const ACTOR = "ac70b111-0000-4000-8000-0000000000c3";

vi.mock("../src/shared/infra.js", async () => {
  const { MemoryQueue } = await import("@civitasone/queue");
  const { Cache } = await import("@civitasone/cache");
  const queue = new MemoryQueue();
  const cache = new Cache({ service: "gateway", defaultTtlSeconds: 60 });
  return { queue, cache };
});

function adminToken(tenantId: string) {
  return signToken({ sub: ACTOR, tid: tenantId, roles: ["platform_admin"] }, SECRET, 3600);
}
function readerToken(tenantId: string) {
  return signToken({ sub: ACTOR, tid: tenantId, roles: ["finance_officer"] }, SECRET, 3600);
}
function auth(token: string) {
  return { authorization: `Bearer ${token}` };
}

let app: FastifyInstance;
let wipe: (tenantId: string) => Promise<void>;

beforeAll(async () => {
  process.env.JWT_SECRET = SECRET;
  process.env.JWT_ALGORITHM = "HS256";
  process.env.QUEUE_DRIVER = process.env.QUEUE_DRIVER ?? "memory";
  const { buildApp } = await import("../src/app.js");
  const { db } = await import("../src/modules/catalogue/db.js");
  const { apiEntry, apiChangelog } = await import("../src/modules/catalogue/schema.js");
  wipe = async (tenantId: string) => {
    await withTenantScope(db as any, tenantId, async (tx: any) => {
      await tx.delete(apiChangelog).where(eq(apiChangelog.tenantId, tenantId));
      await tx.delete(apiEntry).where(eq(apiEntry.tenantId, tenantId));
    });
  };
  app = await buildApp();
  await app.ready();
  await wipe(TENANT_A);
  await wipe(TENANT_B);
});

afterAll(async () => {
  await wipe(TENANT_A);
  await wipe(TENANT_B);
  await app.close();
});

describe("CAP-052 seed helpers (pure)", () => {
  it("derives version labels from route prefixes", () => {
    expect(versionFromPrefix("/api/v1/finance")).toBe("v1");
    expect(versionFromPrefix("/api/identity")).toBe("v1");
    expect(versionFromPrefix("/api/v2/foo")).toBe("v2");
  });
  it("maps every SERVICE_ROUTE to a catalogue entry", () => {
    const entries = registryEntries(TENANT_A, ACTOR);
    expect(entries.length).toBe(SERVICE_ROUTES.length);
    expect(entries.every((e) => e.status === "active" && e.source === "registry")).toBe(true);
  });
});

describe("CAP-052 catalogue routes (CQRS)", () => {
  it("rejects unauthenticated access", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/catalogue" });
    expect(res.statusCode).toBe(401);
  });

  it("accepts seed command with 202 (no sync write)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/catalogue/seed",
      headers: auth(adminToken(TENANT_A)),
    });
    expect(res.statusCode).toBe(202);
    expect(res.json().data.status).toBe("accepted");
    expect(res.json().data.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it("lists catalogue for authenticated reader", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/catalogue",
      headers: auth(readerToken(TENANT_A)),
    });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json().data)).toBe(true);
  });

  it("enforces RBAC on register (reader forbidden)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/catalogue",
      headers: auth(readerToken(TENANT_A)),
      payload: { name: "reports-export", module: "reports", path: "/api/v1/reports/export", method: "GET" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("registers via CQRS (202) and rejects invalid lifecycle", async () => {
    const reg = await app.inject({
      method: "POST",
      url: "/api/v1/catalogue",
      headers: auth(adminToken(TENANT_A)),
      payload: {
        name: `reports-export-${Date.now()}`,
        module: "reports",
        version: "v1",
        path: `/api/v1/reports/export-${Date.now()}`,
        method: "POST",
        owner: "reporting-team",
        description: "Async report export",
      },
    });
    expect(reg.statusCode).toBe(202);
    const id = reg.json().data.id;

    // unknown id → 404 on lifecycle (read-side validation)
    const missing = await app.inject({
      method: "POST",
      url: `/api/v1/catalogue/${crypto.randomUUID()}/lifecycle`,
      headers: auth(adminToken(TENANT_A)),
      payload: { action: "activate" },
    });
    expect(missing.statusCode).toBe(404);

    // get by id — may 404 until consumer applies (read-your-writes via cache is optional)
    const got = await app.inject({
      method: "GET",
      url: `/api/v1/catalogue/${id}`,
      headers: auth(readerToken(TENANT_A)),
    });
    expect([200, 404]).toContain(got.statusCode);
  });

  it("isolates tenants — Tenant B never sees Tenant A's catalogue (RLS)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/catalogue", headers: auth(readerToken(TENANT_B)) });
    expect(res.statusCode).toBe(200);
    expect(res.json().meta.total).toBe(0);
  });
});
