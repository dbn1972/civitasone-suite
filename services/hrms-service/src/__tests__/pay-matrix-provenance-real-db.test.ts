/**
 * GAP-HR-PAY-MATRIX-01 (step 3): every pay-matrix figure the API hands out says
 * whether it is the notified 7th CPC table or a computed approximation -- in
 * particular the annual-increment DRY RUN, whose proposed basic pay used to carry
 * no such marker at all.
 *
 * This does NOT assert any specific pay figure is "right": the official table is
 * not in this repository (see the ledger entry), which is exactly why the marker
 * must be there.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { sqlClient } from "../shared/db.js";
import { PAY_MATRIX_COMPUTED_NOTICE } from "../modules/pay-matrix/routes.js";

// vitest.config.ts injects JWT_SECRET for every service suite; no literal here (gitleaks scans every commit)
const SECRET = process.env.JWT_SECRET as string;
const TENANT = randomUUID();
const auth = (roles: string[]) => ({
  authorization: `Bearer ${signToken({ sub: randomUUID(), tid: TENANT, roles, sid: "sess-pm-prov" }, SECRET, 3600)}`,
});
const ORIGINAL = process.env.PAY_MATRIX_OFFICIAL;
let app: FastifyInstance;

beforeAll(async () => {
  delete process.env.PAY_MATRIX_OFFICIAL;
  app = await buildApp();
});
afterAll(async () => {
  if (ORIGINAL === undefined) delete process.env.PAY_MATRIX_OFFICIAL;
  else process.env.PAY_MATRIX_OFFICIAL = ORIGINAL;
  await app.close();
  await sqlClient.end();
});

describe("pay-matrix provenance marker (GAP-HR-PAY-MATRIX-01)", () => {
  it("the annual-increment dry run is labelled computed / not official, with a notice", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/hrms/pay-matrix/annual-increment", headers: auth(["hr_admin"]),
      payload: { effectiveDate: "2027-07-01", dryRun: true },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ status: "preview", dryRun: true, official: false, matrixSource: "computed" });
    expect(body.notice).toBe(PAY_MATRIX_COMPUTED_NOTICE);
    expect(body.notice).toMatch(/NOT OFFICIAL/);
  });

  it("GET /pay-matrix/lookup carries the same marker", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/hrms/pay-matrix/lookup?level=1&cell=1", headers: auth(["hr_admin"]) });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ level: 1, cell: 1, official: false, matrixSource: "computed" });
    expect(res.json().notice).toMatch(/NOT OFFICIAL/);
  });

  it("GET /pay-matrix still reports official:false (the page's badge reads this)", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/hrms/pay-matrix?level=1", headers: auth(["hr_admin"]) });
    expect(res.statusCode).toBe(200);
    expect(res.json().official).toBe(false);
  });

  it("a live run is still blocked while the matrix is not official", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/hrms/pay-matrix/annual-increment", headers: auth(["hr_admin"]),
      payload: { effectiveDate: "2027-07-01", dryRun: false },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("PAY_MATRIX_NOT_OFFICIAL");
  });

  it("once the matrix is marked official the dry run says so and carries no notice", async () => {
    process.env.PAY_MATRIX_OFFICIAL = "true";
    try {
      const res = await app.inject({
        method: "POST", url: "/v1/hrms/pay-matrix/annual-increment", headers: auth(["hr_admin"]),
        payload: { effectiveDate: "2027-07-01", dryRun: true },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toMatchObject({ official: true, matrixSource: "official" });
      expect(body.notice).toBeUndefined();
    } finally {
      delete process.env.PAY_MATRIX_OFFICIAL;
    }
  });

  it("a role outside the annual-increment audience is still refused", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/hrms/pay-matrix/annual-increment", headers: auth(["employee"]),
      payload: { dryRun: true },
    });
    expect(res.statusCode).toBe(403);
  });
});
