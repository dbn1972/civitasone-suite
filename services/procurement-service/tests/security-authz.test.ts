/**
 * GAP-PROCUREMENT-EMD-BG-06: EMD/PBG forfeiture, refund and release are
 * money-adjacent dispositions of security deposits. They MUST be role-guarded
 * server-side (not merely hidden in the UI). This pins the existing guard:
 * a non-procurement role (citizen) is rejected with 403 FORBIDDEN on every
 * disposition endpoint, while an authorised procurement officer is accepted
 * (202). The consumer additionally records an audit event and a balanced
 * finance GL post in the same transaction (see security/consumer.ts) — the
 * capability the audit flagged as "cannot-verify / service absent" is present
 * and enforced.
 */
import { describe, it, expect, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-5555-4000-8000-000000000099";
const FAKE_UUID = "00000000-0000-4000-8000-00000000ab01";

function tok(roles: string[]) {
  return signToken({ sub: "user-sec-001", tid: TENANT, roles, sid: "sess-sec-001" }, SECRET);
}
const procAuth = { authorization: `Bearer ${tok(["procurement_officer"])}` };
const citizenAuth = { authorization: `Bearer ${tok(["citizen"])}` };

afterAll(async () => { await sqlClient.end(); });

const DISPOSITIONS = [
  `/v1/procurement/emd/${FAKE_UUID}/forfeit`,
  `/v1/procurement/emd/${FAKE_UUID}/refund`,
  `/v1/procurement/pbg/${FAKE_UUID}/forfeit`,
  `/v1/procurement/pbg/${FAKE_UUID}/release`,
];

describe("EMD/PBG dispositions — server-side authorization (GAP-PROCUREMENT-EMD-BG-06)", () => {
  for (const url of DISPOSITIONS) {
    it(`POST ${url} → 403 for a non-procurement (citizen) role`, async () => {
      const app = await buildApp();
      const res = await app.inject({ method: "POST", url, headers: citizenAuth, payload: { reason: "test" } });
      await app.close();
      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe("FORBIDDEN");
    });

    it(`POST ${url} → 202 for an authorised procurement officer`, async () => {
      const app = await buildApp();
      const res = await app.inject({ method: "POST", url, headers: procAuth, payload: { reason: "test" } });
      await app.close();
      expect(res.statusCode).toBe(202);
    });
  }
});
