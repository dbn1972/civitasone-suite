/**
 * CLOS3-S5-08: GET /v1/hrms/internal/leave-periods -- the internal approved-leave read
 * inspection-service's tour-plan generation calls (the old GET /v1/hrms/leave did not exist).
 */
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";

const SECRET = globalThis.crypto.randomUUID();
process.env.INTERNAL_SERVICE_SECRET = SECRET;

const TENANT = "aaaaaaaa-1111-4000-8000-000000000508";
const OTHER_TENANT = "bbbbbbbb-1111-4000-8000-000000000508";
const EMP = "cccccccc-1111-4000-8000-000000000508";

const { findPeriods } = vi.hoisted(() => ({ findPeriods: vi.fn() }));
vi.mock("../src/modules/leave/repo.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  findApprovedLeavePeriods: (...a: unknown[]) => findPeriods(...a),
}));

import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

afterAll(async () => { await (sqlClient as { end: () => Promise<void> }).end(); });
beforeEach(() => findPeriods.mockReset());

const url = `/v1/hrms/internal/leave-periods?employeeId=${EMP}&startDate=2026-11-01&endDate=2026-11-30`;
const svc = (tenant = TENANT, secret = SECRET) => ({ "x-internal": "1", "x-service-secret": secret, "x-tenant-id": tenant });

describe("GET /v1/hrms/internal/leave-periods", () => {
  it("returns only {startDate,endDate} pairs, scoped to the x-tenant-id tenant", async () => {
    findPeriods.mockResolvedValueOnce([{ startDate: "2026-11-10", endDate: "2026-11-12" }]);
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url, headers: svc() });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([{ startDate: "2026-11-10", endDate: "2026-11-12" }]);
    expect(findPeriods).toHaveBeenCalledWith(TENANT, EMP, "2026-11-01", "2026-11-30");
  });

  it("another tenant's header queries that tenant only (and gets no rows)", async () => {
    findPeriods.mockResolvedValueOnce([]);
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url, headers: svc(OTHER_TENANT) });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
    expect(findPeriods).toHaveBeenCalledWith(OTHER_TENANT, EMP, "2026-11-01", "2026-11-30");
  });

  it("is 401 without a valid service secret and never reads", async () => {
    const app = await buildApp();
    const none = await app.inject({ method: "GET", url, headers: { "x-tenant-id": TENANT } });
    const bad = await app.inject({ method: "GET", url, headers: svc(TENANT, "wrong") });
    await app.close();
    expect(none.statusCode).toBe(401);
    expect(bad.statusCode).toBe(401);
    expect(findPeriods).not.toHaveBeenCalled();
  });

  it("rejects a malformed query and an inverted range with 400", async () => {
    const app = await buildApp();
    const bad = await app.inject({ method: "GET", url: "/v1/hrms/internal/leave-periods?employeeId=x&startDate=a&endDate=b", headers: svc() });
    const inv = await app.inject({ method: "GET", url: `/v1/hrms/internal/leave-periods?employeeId=${EMP}&startDate=2026-12-01&endDate=2026-11-01`, headers: svc() });
    await app.close();
    expect(bad.statusCode).toBe(400);
    expect(inv.statusCode).toBe(400);
    expect(findPeriods).not.toHaveBeenCalled();
  });
});
