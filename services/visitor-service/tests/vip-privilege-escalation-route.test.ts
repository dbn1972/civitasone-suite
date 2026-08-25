/**
 * VIP-pass audit — privilege-escalation, route boundary (real app, real DB).
 *
 * Companion to tests/vip-privilege-escalation.test.ts (domain + consumer
 * layers). This file proves the HTTP boundary itself: an "employee" token —
 * the lowest-privilege role permitted to call POST /v1/visitor/visit-requests
 * at all (see WRITE_ROLES in modules/visit-request/routes.ts) — is not
 * additionally restricted from setting `visitorCategory: "vip"` on that
 * request, while the VIP log's read side (GET /v1/visitor/vip/log) IS
 * correctly restricted. No commands/db mocking: the route's synchronous
 * pre-publish work (blacklist screen, fuzzy screen, consent log, schedule
 * policy lookup) runs for real against the shared dev Postgres, matching the
 * pattern in tests/routes-rbac-deep.test.ts and tests/tenant-isolation.
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

describe("POST /v1/visitor/visit-requests — no role gate on visitorCategory (route boundary)", () => {
  it("an 'employee' token may set visitorCategory='vip' and gets 202, not 403", async () => {
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

    expect(res.statusCode).toBe(202);
  });

  it("control: the identical request with visitorCategory omitted (defaults to standard) also gets 202 — the 403 boundary tested below is specific to the READ side, not this write", async () => {
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

  it("contrast: GET /v1/visitor/vip/log correctly DOES restrict 'employee' (403) — the read side is gated, the write/grant side above is not", async () => {
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
