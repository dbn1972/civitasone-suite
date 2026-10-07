/**
 * GAP-PROCUREMENT-EMPANELMENT-05: empanelment is enforced server-side, not just
 * in the UI. This pins the three guarantees the audit flagged as
 * "cannot-verify / service absent":
 *  1) a blacklisted vendor can never be empanelled (domain rule);
 *  2) empanelment (PATCH /vendors/:id/empanel) is role-guarded (403 for a
 *     non-procurement role);
 *  3) the empanelment register (GET /v1/procurement/empanelment) is role-guarded.
 */
import { describe, it, expect, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { assertCanEmpanel, DomainError } from "../src/modules/vendor/domain.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-6666-4000-8000-000000000099";
const FAKE_UUID = "00000000-0000-4000-8000-00000000cd01";

function tok(roles: string[]) {
  return signToken({ sub: "user-emp-001", tid: TENANT, roles, sid: "sess-emp-001" }, SECRET);
}
const citizenAuth = { authorization: `Bearer ${tok(["citizen"])}` };

afterAll(async () => { await sqlClient.end(); });

describe("empanelment server-side enforcement (GAP-PROCUREMENT-EMPANELMENT-05)", () => {
  it("rejects empanelling a blacklisted vendor (domain rule)", () => {
    expect(() => assertCanEmpanel("blacklisted")).toThrow(DomainError);
    expect(() => assertCanEmpanel("registered")).not.toThrow();
  });

  it("PATCH /vendors/:id/empanel is role-guarded (403 for a citizen)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH", url: `/v1/procurement/vendors/${FAKE_UUID}/empanel`,
      headers: citizenAuth, payload: { category: "Civil" },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("FORBIDDEN");
  });

  it("GET /v1/procurement/empanelment is role-guarded (403 for a citizen)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: "/v1/procurement/empanelment", headers: citizenAuth,
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});
