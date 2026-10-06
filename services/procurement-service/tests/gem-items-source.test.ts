/**
 * GAP-PROCUREMENT-GEM-06: the GeM items feed is NOT fabricated and its source
 * is honest. GET /v1/procurement/gem/items:
 *  - is role-guarded (403 for a non-procurement role);
 *  - when the GeM integration is not configured (default), returns an honest
 *    empty list with meta.integrationDisabled + a human reason — never
 *    invented order rows. When enabled it aliases the LIVE GeM catalog search
 *    (source = GeM API), so prices shown are real, not a stub.
 *
 * There is no manual-upload path on this surface, so a `source=manual /
 * importedBy` record is N/A; the authenticity concern is met by sourcing from
 * the live catalog or failing closed with a documented reason.
 */
import { describe, it, expect, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-7777-4000-8000-000000000099";

function tok(roles: string[]) {
  return signToken({ sub: "user-gem-001", tid: TENANT, roles, sid: "sess-gem-001" }, SECRET);
}
const procAuth = { authorization: `Bearer ${tok(["procurement_officer"])}` };
const citizenAuth = { authorization: `Bearer ${tok(["citizen"])}` };

afterAll(async () => { await sqlClient.end(); });

describe("GET /v1/procurement/gem/items — honest source (GAP-PROCUREMENT-GEM-06)", () => {
  it("is role-guarded (403 for a citizen)", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/procurement/gem/items", headers: citizenAuth });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("returns an honest empty list with integrationDisabled when GeM is not configured — never fabricated rows", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/procurement/gem/items", headers: procAuth });
    await app.close();
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toEqual([]);
    expect(body.meta.integrationDisabled).toBe(true);
    expect(typeof body.meta.reason).toBe("string");
  });
});
