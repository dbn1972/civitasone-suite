/**
 * VIP-pass audit — privilege-escalation, route boundary (real app, real DB).
 *
 * Companion to tests/vip-privilege-escalation.test.ts (domain + consumer
 * layers). This file originally proved the HTTP boundary bug: an "employee"
 * token — the lowest-privilege role permitted to call
 * POST /v1/visitor/visit-requests at all (see WRITE_ROLES in
 * modules/visit-request/routes.ts) — was not additionally restricted from
 * setting `visitorCategory: "vip"` on that request, while the VIP log's read
 * side (GET /v1/visitor/vip/log) was correctly restricted.
 *
 * FIXED: routes.ts now gates `visitorCategory: "vip"` behind VIP_GRANT_ROLES
 * (protocol_officer/security_admin/tenant_admin/super_admin — the same roles
 * already trusted to approve/reject any visit request, since setting vip
 * bypasses that exact approval step) and rejects any other WRITE_ROLES caller
 * with 403 before the request is ever published to the queue. The tests below
 * now prove: (1) an unauthorized "employee" caller is rejected, (2) an
 * authorized "protocol_officer" caller still succeeds, (3) an ordinary
 * (non-vip) request is completely unaffected, and (4) the pre-existing
 * read-side gate on the VIP log is unchanged.
 *
 * No commands/db mocking: the route's synchronous pre-publish work
 * (blacklist screen, fuzzy screen, consent log, schedule policy lookup) runs
 * for real against the shared dev Postgres, matching the pattern in
 * tests/routes-rbac-deep.test.ts and tests/tenant-isolation.
 * integration.test.ts. Uses a fresh random tenant so it never touches the
 * shared AUDIT test tenant's data.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { visitRequests } from "../src/modules/visit-request/schema.js";

const SECRET = process.env.JWT_SECRET as string;
const TENANT = randomUUID();
const ACTOR = randomUUID();
const LOCATION_ID = randomUUID();
const HOST_ID = randomUUID();

function token(roles: string[]): string {
  return signToken({ sub: ACTOR, tid: TENANT, roles, sid: "sess-vip-audit" }, SECRET, 3600);
}
function headers(roles: string[]) {
  return { authorization: `Bearer ${token(roles)}` };
}

let app: FastifyInstance;

beforeAll(async () => {
  const { buildApp } = await import("../src/app.js");
  app = await buildApp();
});

afterAll(async () => {
  // Best-effort cleanup of anything this file created under its own
  // throwaway random tenant (never the shared AUDIT test tenant).
  await runWithTenant(TENANT, () =>
    db.transaction((tx) => tx.delete(visitRequests).where(eq(visitRequests.tenantId, TENANT))),
  ).catch(() => undefined);
  await app.close();
  await sqlClient.end();
});

describe("POST /v1/visitor/visit-requests — visitorCategory='vip' is now role-gated (route boundary)", () => {
  it("FIXED: an 'employee' token attempting visitorCategory='vip' now gets 403, not 202", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/visitor/visit-requests",
      headers: headers(["employee"]),
      payload: {
        locationId: LOCATION_ID,
        visitorName: "AUDIT-VIP-ROUTE-PROBE Visitor",
        visitorPhone: "9990004444",
        purpose: "audit: route-level VIP escalation probe",
        hostEmployeeId: HOST_ID,
        scheduledAt: new Date(Date.now() + 2 * 86_400_000).toISOString(),
        visitorCategory: "vip",
        source: "portal",
      },
    });

    expect(res.statusCode).toBe(403);
    const body = res.json() as { code?: string };
    expect(body.code).toBe("FORBIDDEN");
  });

  it("positive control: a 'protocol_officer' token (an authorized VIP_GRANT_ROLES role) MAY set visitorCategory='vip' and still gets 202 — the fix rejects unauthorized roles only, not the feature itself", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/visitor/visit-requests",
      headers: headers(["protocol_officer"]),
      payload: {
        locationId: LOCATION_ID,
        visitorName: "AUDIT-VIP-ROUTE-AUTHORIZED Visitor",
        visitorPhone: "9990006666",
        purpose: "audit: route-level VIP grant by an authorized role",
        hostEmployeeId: HOST_ID,
        scheduledAt: new Date(Date.now() + 2 * 86_400_000).toISOString(),
        visitorCategory: "vip",
        source: "portal",
      },
    });

    expect(res.statusCode).toBe(202);
  });

  it("control: the identical request with visitorCategory omitted (defaults to standard) also gets 202 — the vip-specific gate above does not affect ordinary requests", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/visitor/visit-requests",
      headers: headers(["employee"]),
      payload: {
        locationId: LOCATION_ID,
        visitorName: "AUDIT-VIP-ROUTE-CONTROL Visitor",
        visitorPhone: "9990005555",
        purpose: "audit: route-level control (standard)",
        hostEmployeeId: HOST_ID,
        scheduledAt: new Date(Date.now() + 2 * 86_400_000).toISOString(),
        source: "portal",
      },
    });

    expect(res.statusCode).toBe(202);
  });

  it("GET /v1/visitor/vip/log also correctly restricts 'employee' (403) — read side and write/grant side are now both gated", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/visitor/vip/log",
      headers: headers(["employee"]),
    });
    expect(res.statusCode).toBe(403);
  });

  it("protocol_officer CAN read the VIP log (positive control for the contrast above)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/visitor/vip/log",
      headers: headers(["protocol_officer"]),
    });
    expect(res.statusCode).toBe(200);
  });
});
