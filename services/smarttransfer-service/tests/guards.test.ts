/**
 * SmartTransfer route guards (real Postgres for app build; entitlement fetch
 * stubbed per tenant).
 *
 * - requireRole: every route is staff-only; citizen is rejected with 403.
 * - in-service entitlement re-check: FAILS CLOSED when `smarttransfer` is not
 *   in the composition projection, when the tenant never onboarded
 *   (configured:false), and when admin-service is unreachable; ALLOWS only when
 *   the projection lists `smarttransfer`.
 *
 * Distinct tenant ids per scenario so the per-tenant entitlement cache does not
 * carry a decision across cases.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { authHeader, stubCompositionFetch } from "./_helpers.js";
import { requireSmartTransferEntitlement } from "../src/shared/entitlement.js";
import type { RequestContext } from "@civitasone/types";

const ACTOR = "44444444-0000-4000-8000-0000000000aa";

function body() {
  return {
    name: "Guard cycle",
    movementTypeId: randomUUID(),
    calendar: {
      opensAt: "2026-01-01T00:00:00.000Z",
      freezesAt: "2026-02-01T00:00:00.000Z",
      closesAt: "2026-03-01T00:00:00.000Z",
    },
  };
}

let app: FastifyInstance;
let restoreFetch: () => void;

const ENABLED = "aaaa1111-0000-4000-8000-000000000001";
const DISABLED = "aaaa2222-0000-4000-8000-000000000002";
const UNONBOARDED = "aaaa3333-0000-4000-8000-000000000003";
const OUTAGE = "aaaa4444-0000-4000-8000-000000000004";
const CITIZEN_TENANT = "aaaa5555-0000-4000-8000-000000000005";

beforeAll(async () => {
  restoreFetch = stubCompositionFetch((tenantId) => {
    if (tenantId === ENABLED || tenantId === CITIZEN_TENANT) {
      return { configured: true, data: [{ name: "workforce_core" }, { name: "smarttransfer" }] };
    }
    if (tenantId === DISABLED) return { configured: true, data: [{ name: "workforce_core" }] };
    if (tenantId === UNONBOARDED) return { configured: false };
    if (tenantId === OUTAGE) return "throw";
    return { configured: false };
  });
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  restoreFetch();
  await app.close();
  await sqlClient.end();
});

describe("requireRole — staff only, citizen excluded", () => {
  it("rejects a citizen with 403 (never reaches entitlement or the write)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/smarttransfer/cycles",
      headers: authHeader(CITIZEN_TENANT, ACTOR, ["citizen"]),
      payload: body(),
    });
    expect(res.statusCode).toBe(403);
    expect((res.json() as { code: string }).code).toBe("FORBIDDEN");
  });

  it("rejects a request with no bearer token (401)", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/smarttransfer/cycles" });
    expect(res.statusCode).toBe(401);
  });

  it("accepts a staff role (202) for an entitled tenant", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/smarttransfer/cycles",
      headers: authHeader(ENABLED, ACTOR, ["officer"]),
      payload: body(),
    });
    expect(res.statusCode).toBe(202);
  });
});

describe("in-service entitlement re-check — fails CLOSED", () => {
  it("DENIES (403) when the composition projection does not list smarttransfer", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/smarttransfer/cycles",
      headers: authHeader(DISABLED, ACTOR, ["smarttransfer_admin"]),
    });
    expect(res.statusCode).toBe(403);
    expect((res.json() as { code: string }).code).toBe("MODULE_NOT_ENTITLED");
  });

  it("DENIES (403) when the tenant never onboarded (configured:false) — fails CLOSED, unlike the gateway's legacy fail-open", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/smarttransfer/cycles",
      headers: authHeader(UNONBOARDED, ACTOR, ["smarttransfer_admin"]),
    });
    expect(res.statusCode).toBe(403);
    expect((res.json() as { code: string }).code).toBe("MODULE_NOT_ENTITLED");
  });

  it("DENIES (403) when admin-service is unreachable (outage/breaker) — fails CLOSED", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/smarttransfer/cycles",
      headers: authHeader(OUTAGE, ACTOR, ["smarttransfer_admin"]),
    });
    expect(res.statusCode).toBe(403);
    expect((res.json() as { code: string }).code).toBe("MODULE_NOT_ENTITLED");
  });

  it("DENIES (403) a malformed tenant id without ever calling admin-service (no SSRF path)", async () => {
    const seen: string[] = [];
    const restore = stubCompositionFetch((tenantId) => {
      seen.push(tenantId);
      return { configured: true, data: [{ name: "smarttransfer" }] };
    });
    try {
      for (const tenantId of ["../../../internal/secrets", "x?y=1", `${ENABLED}/..`]) {
        await expect(
          requireSmartTransferEntitlement({ tenantId } as unknown as RequestContext),
        ).rejects.toMatchObject({ status: 403, code: "MODULE_NOT_ENTITLED" });
      }
      expect(seen).toEqual([]);
    } finally {
      restore();
    }
  });

  it("ALLOWS (200) when the projection lists smarttransfer", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/smarttransfer/cycles",
      headers: authHeader(ENABLED, ACTOR, ["smarttransfer_admin"]),
    });
    expect(res.statusCode).toBe(200);
  });
});
