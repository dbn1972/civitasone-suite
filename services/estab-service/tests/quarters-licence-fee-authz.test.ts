/**
 * GAP2-ESTAB-QUARTERS-RATEAUTHZ-01 + GAP2-ESTAB-LICENCEFEE-RATE-UNBOUNDED-01 —
 * licence-fee rate route authz + bounded list.
 *
 * Fails on the old routes (which gated POST to ESTAB_ROLES incl. estab_officer
 * and ignored limit/offset on the GET).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../src/app.js";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "7ca10001-0000-4000-8000-0000000000f1";
const ACTOR = "7ca10001-0000-4000-8000-0000000000f2";

function auth(roles: string[]) {
  const token = signToken({ sub: ACTOR, tid: TENANT, roles, sid: "s1" }, SECRET, 3600);
  return { authorization: `Bearer ${token}` };
}

let app: FastifyInstance;
beforeAll(async () => { app = await buildApp(); await app.ready(); });
afterAll(async () => { await app.close(); });

const ratePayload = { quarterType: "type_iv", payLevel: "level_7", monthlyMinor: 450000, effectiveFrom: "2026-04-01" };

describe("GAP2-ESTAB-QUARTERS-RATEAUTHZ-01 — rate config is admin-only", () => {
  it("plain estab_officer is FORBIDDEN (403) from creating a licence-fee rate", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/estab/quarter-licence-fees",
      headers: auth(["estab_officer"]), payload: ratePayload,
    });
    expect(res.statusCode).toBe(403);
  });

  it("estab_admin is accepted (202)", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/estab/quarter-licence-fees",
      headers: auth(["estab_admin"]), payload: ratePayload,
    });
    expect(res.statusCode).toBe(202);
  });

  it("super_admin is accepted (202)", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/estab/quarter-licence-fees",
      headers: auth(["super_admin"]), payload: ratePayload,
    });
    expect(res.statusCode).toBe(202);
  });
});

describe("GAP2-ESTAB-LICENCEFEE-RATE-UNBOUNDED-01 — list is bounded", () => {
  it("GET ?limit=1 returns at most 1 row", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/estab/quarter-licence-fees?limit=1",
      headers: auth(["estab_admin"]),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBeLessThanOrEqual(1);
  });

  it("GET ?limit=0 is rejected (400) — positive bound enforced", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/estab/quarter-licence-fees?limit=0",
      headers: auth(["estab_admin"]),
    });
    expect(res.statusCode).toBe(400);
  });
});
