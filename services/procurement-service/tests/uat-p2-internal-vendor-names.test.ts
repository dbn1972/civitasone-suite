/**
 * UAT Phase 2 C7 + security review #2446 (3): GET /v1/procurement/internal/
 * vendor-names is service-to-service only. A direct call with x-internal +
 * the service secret (how finance-service calls it) answers id -> name only;
 * a user token — even super_admin — is refused, as is x-internal without the
 * right secret. (The gateway additionally refuses every /internal path:
 * gateway-service tests/internal-path-deny.test.ts.)
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { procurementVendors } from "../src/modules/vendor/schema.js";
import type { FastifyInstance } from "fastify";

const TENANT = randomUUID();
const OTHER_TENANT = randomUUID();
const ACTOR = randomUUID();
const V1 = randomUUID();
const V_OTHER = randomUUID();
const SERVICE_SECRET = `svc-${randomUUID()}`;
let app: FastifyInstance;
let previousSecret: string | undefined;

beforeAll(async () => {
  previousSecret = process.env.INTERNAL_SERVICE_SECRET;
  process.env.INTERNAL_SERVICE_SECRET = SERVICE_SECRET;
  process.env.PII_ENC_KEY = process.env.PII_ENC_KEY ?? "test_pii_encryption_key_32chars!!";
  const { buildApp } = await import("../src/app.js");
  app = await buildApp();
  await app.ready();
  await runWithTenant(TENANT, () => db.transaction((tx) => tx.insert(procurementVendors).values({ id: V1, tenantId: TENANT, name: "UATTEST-g4-5-A", pan: "AAAAA0000A", createdBy: ACTOR, updatedBy: ACTOR })));
  await runWithTenant(OTHER_TENANT, () => db.transaction((tx) => tx.insert(procurementVendors).values({ id: V_OTHER, tenantId: OTHER_TENANT, name: "Other tenant vendor", createdBy: ACTOR, updatedBy: ACTOR })));
});
afterAll(async () => {
  for (const t of [TENANT, OTHER_TENANT]) {
    await runWithTenant(t, () => db.transaction((tx) => tx.delete(procurementVendors).where(eq(procurementVendors.tenantId, t))));
  }
  await app.close();
  await sqlClient.end();
  if (previousSecret === undefined) delete process.env.INTERNAL_SERVICE_SECRET; else process.env.INTERNAL_SERVICE_SECRET = previousSecret;
});

const url = `/v1/procurement/internal/vendor-names?ids=${V1},${V_OTHER}`;

describe("internal vendor-names", () => {
  it("service-to-service (x-internal + service secret): 200, own-tenant id -> name only, no PII", async () => {
    const res = await app.inject({ method: "GET", url, headers: { "x-internal": "1", "x-service-secret": SERVICE_SECRET, "x-tenant-id": TENANT } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ data: [{ id: V1, name: "UATTEST-g4-5-A" }] });
    expect(res.body).not.toContain("AAAAA0000A");
  });

  it("x-internal with a wrong secret: 401", async () => {
    const res = await app.inject({ method: "GET", url, headers: { "x-internal": "1", "x-service-secret": "wrong", "x-tenant-id": TENANT } });
    expect(res.statusCode).toBe(401);
  });

  it.each([["procurement_officer"], ["super_admin"], ["finance_officer"]])("a user token (%s) is refused: 403", async (role) => {
    const token = signToken({ sub: ACTOR, tid: TENANT, roles: [role], sid: "s-vn" }, process.env.JWT_SECRET as string, 3600);
    const res = await app.inject({ method: "GET", url, headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(403);
  });

  it("rejects a non-uuid / oversized id list: 400", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/procurement/internal/vendor-names?ids=not-a-uuid", headers: { "x-internal": "1", "x-service-secret": SERVICE_SECRET, "x-tenant-id": TENANT } });
    expect(res.statusCode).toBe(400);
  });
});

// UX-R5 (names, not ids): the user-facing twin, so record screens name the vendor instead of a UUID.
describe("GET /v1/procurement/vendors/names (reader roles)", () => {
  const userUrl = `/v1/procurement/vendors/names?ids=${V1},${V_OTHER}`;
  const bearer = (role: string, tid = TENANT) =>
    ({ authorization: `Bearer ${signToken({ sub: ACTOR, tid, roles: [role], sid: "s-vn2" }, process.env.JWT_SECRET as string, 3600)}` });

  it.each([["procurement_officer"], ["audit_officer"], ["finance_officer"], ["contract_manager"]])("%s: own-tenant id -> name only, no PII, other tenant never", async (role) => {
    const res = await app.inject({ method: "GET", url: userUrl, headers: bearer(role) });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ data: [{ id: V1, name: "UATTEST-g4-5-A" }] });
    expect(res.body).not.toContain("AAAAA0000A");
  });

  it("a role outside the vendor-register readers is refused: 403", async () => {
    const res = await app.inject({ method: "GET", url: userUrl, headers: bearer("employee") });
    expect(res.statusCode).toBe(403);
  });

  it("401 without a token; 400 for a non-uuid id", async () => {
    expect((await app.inject({ method: "GET", url: userUrl })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/v1/procurement/vendors/names?ids=nope", headers: bearer("procurement_officer") })).statusCode).toBe(400);
  });
});
