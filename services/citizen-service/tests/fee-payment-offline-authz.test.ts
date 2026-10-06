/**
 * GAP-CITIZEN-PAYMENTS-03 — DB-backed authz pin (integrator run).
 *
 * The fixer established by inspection that POST /v1/citizen/payments/offline is
 * gated by requireRole(ctx, OFFICER_ROLES) — so a bare `citizen` cannot record
 * a cash/offline receipt — but could NOT run the DB-backed route test because
 * the throwaway test Postgres (:5672) was down. The DB is back; this pins it.
 *
 * requireRole throws 403 BEFORE the body is parsed, so the citizen rejection is
 * a pure gate and needs no seeding. The officer path is asserted only to NOT be
 * a 401/403 (it proceeds past the gate; exact downstream status depends on the
 * payload, which is out of scope for this authz pin).
 *
 * Source: modules/fee-payment/routes.ts (OFFICER_ROLES), shared/context.ts.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-0000000000f1";
const CITIZEN = "11111111-1111-4000-8000-0000000000f1";
const OFFICER = "99999999-9999-4000-8000-0000000000f1";

function tok(sub: string, roles: string[]) {
  return signToken({ sub, tid: TENANT, roles, sid: "s" }, SECRET, 3600);
}
const citizenH = { authorization: `Bearer ${tok(CITIZEN, ["citizen"])}`, "content-type": "application/json" };
const officerH = { authorization: `Bearer ${tok(OFFICER, ["citizen_officer"])}`, "content-type": "application/json" };

const offlinePayload = {
  applicationId: "22222222-2222-4000-8000-0000000000f1",
  scheduleId: "33333333-3333-4000-8000-0000000000f1",
  subject: {},
};

let app: FastifyInstance;
beforeAll(async () => { app = await buildApp(); });
afterAll(async () => { await app.close(); await sqlClient.end(); });

describe("GAP-CITIZEN-PAYMENTS-03 — offline payment is officer-gated", () => {
  it("401 without a token", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/citizen/payments/offline", payload: offlinePayload,
    });
    expect(res.statusCode).toBe(401);
  });

  it("a bare citizen recording an offline/cash payment → 403 FORBIDDEN", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/citizen/payments/offline",
      headers: citizenH, payload: offlinePayload,
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("FORBIDDEN");
  });

  it("an officer passes the role gate (not 401/403)", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/citizen/payments/offline",
      headers: officerH, payload: offlinePayload,
    });
    expect(res.statusCode).not.toBe(401);
    expect(res.statusCode).not.toBe(403);
  });
});
