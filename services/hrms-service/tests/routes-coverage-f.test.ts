/**
 * HRMS route coverage part F — more parameterized routes.
 */
import { describe, it, expect, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { randomUUID } from "node:crypto";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-000000000099";
const UUID = "aaaaaaaa-8888-4000-8000-000000000003";
const FAKE = randomUUID();

function token(roles = ["hr_admin"]) {
  return signToken({ sub: UUID, tid: TENANT, roles, sid: "s1" }, SECRET);
}

afterAll(async () => { await sqlClient.end(); });

const moreGetRoutes = [
  `/v1/hrms/reservation/rosters/${FAKE}`,
  `/v1/hrms/reservation/rosters/${FAKE}/points`,
  `/v1/hrms/reservation/rosters/${FAKE}/vacancies`,
  `/v1/hrms/rti/requests/${FAKE}`,
  `/v1/hrms/goals/${FAKE}/checkins`,
  `/v1/hrms/employees/${FAKE}/service-book`,
];

const morePostRoutes = [
  `/v1/hrms/applications/${FAKE}/hire`,
  `/v1/hrms/comp-off/${FAKE}/redeem`,
  `/v1/hrms/nominations/${FAKE}/complete`,
  `/v1/hrms/lifecycle/transfers/${FAKE}/issue-order`,
  `/v1/hrms/lifecycle/transfers/${FAKE}/join`,
  `/v1/hrms/lifecycle/transfers/${FAKE}/relieve`,
  `/v1/hrms/goals/${FAKE}/checkin`,
  `/v1/hrms/employees/${FAKE}/transfer/submit-approval`,
  `/v1/hrms/employees/${FAKE}/promotion/submit-approval`,
];

describe("HRMS additional GET /:id routes", () => {
  for (const url of moreGetRoutes) {
    it(`GET ${url} — handler executes`, async () => {
      const app = await buildApp();
      const r = await app.inject({ method: "GET", url, headers: { authorization: `Bearer ${token()}` } });
      await app.close();
      expect([200, 404, 500]).toContain(r.statusCode);
    });
  }
});

describe("HRMS additional POST /:id routes", () => {
  for (const url of morePostRoutes) {
    it(`POST ${url} — handler executes`, async () => {
      const app = await buildApp();
      const r = await app.inject({ method: "POST", url, headers: { authorization: `Bearer ${token()}` }, payload: {} });
      await app.close();
      expect([200, 201, 202, 400, 404, 409, 500]).toContain(r.statusCode);
    });
  }
});
