/**
 * GAP-PAYROLL-GPF-02 / NPS-02 / FNF-05 (b2-payroll-retirement batch):
 * - employee-summaries now also returns `employeeNo` (the HR employee code),
 *   so payroll's statutory ledgers / F&F cards can show a real code instead
 *   of a fabricated UUID prefix.
 * - nps-pran-last4 returns ONLY the last four PRAN characters per employee;
 *   the full PRAN never crosses the service boundary.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-0000000000b2";
const USER = "aaaaaaaa-7777-4000-8000-0000000000b2";

const { scopedReadMock } = vi.hoisted(() => ({ scopedReadMock: vi.fn() }));
vi.mock("../src/shared/db.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  scopedRead: (...a: unknown[]) => scopedReadMock(...a),
}));

import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { MAX_ACCOUNTS } from "../src/modules/internal/retirement-accounts-routes.js";

afterAll(async () => { await (sqlClient as { end: () => Promise<void> }).end(); });
beforeEach(() => scopedReadMock.mockReset());

const auth = (roles = ["payroll_admin"]) => ({ authorization: `Bearer ${signToken({ sub: USER, tid: TENANT, roles, sid: "s1" }, SECRET)}` });

describe("GET /v1/hrms/internal/employee-summaries", () => {
  it("includes employeeNo alongside fullName/departmentName", async () => {
    scopedReadMock
      .mockResolvedValueOnce([{ id: "e1", fullName: "Meera Iyer", employeeNo: "EMP-0451", departmentId: "d1" }])
      .mockResolvedValueOnce([{ id: "d1", name: "Finance" }]);
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/hrms/internal/employee-summaries", headers: auth() });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([{ id: "e1", fullName: "Meera Iyer", employeeNo: "EMP-0451", departmentName: "Finance" }]);
  });
});

describe("GET /v1/hrms/internal/nps-pran-last4", () => {
  it("returns only the last 4 PRAN characters, never the full PRAN", async () => {
    scopedReadMock.mockResolvedValueOnce([
      { employeeId: "e1", pran: "110012345678" },
      { employeeId: "e2", pran: "110087654321" },
    ]);
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/hrms/internal/nps-pran-last4", headers: auth() });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([
      { employeeId: "e1", pranLast4: "5678" },
      { employeeId: "e2", pranLast4: "4321" },
    ]);
    expect(res.body).not.toContain("110012345678");
  });

  it("is not reachable by a plain employee", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/hrms/internal/nps-pran-last4", headers: auth(["employee"]) });
    await app.close();
    expect(res.statusCode).toBe(403);
    expect(scopedReadMock).not.toHaveBeenCalled();
  });
});

describe("GET /v1/hrms/internal/retirement-accounts (GAP-PAYROLL-STATUTORY-GPF-02 / NPS-02)", () => {
  it("returns only contribution parameters -- no PRAN, GPF number or balance", async () => {
    scopedReadMock
      .mockResolvedValueOnce([{ employeeId: "e1", monthlySubscriptionMinor: 960000n, status: "active" }])
      .mockResolvedValueOnce([{ employeeId: "e1", empContribPct: "10.00", erContribPct: "14.00", status: "active" }]);
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/hrms/internal/retirement-accounts", headers: auth() });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      gpfTruncated: false,
      npsTruncated: false,
      gpf: [{ employeeId: "e1", monthlySubscriptionMinor: "960000", status: "active" }],
      nps: [{ employeeId: "e1", empContribPct: 10, erContribPct: 14, status: "active" }],
    });
  });

  it("reports truncation when more than the cap exist, and returns exactly the cap", async () => {
    const gpfRows = Array.from({ length: MAX_ACCOUNTS + 1 }, (_, i) => ({ employeeId: `e${i}`, monthlySubscriptionMinor: 1n, status: "active" }));
    scopedReadMock.mockResolvedValueOnce(gpfRows).mockResolvedValueOnce([]);
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/hrms/internal/retirement-accounts", headers: auth() });
    await app.close();
    const body = res.json();
    expect(body.gpfTruncated).toBe(true);
    expect(body.npsTruncated).toBe(false);
    expect(body.gpf).toHaveLength(MAX_ACCOUNTS);
  });

  it("is not reachable by a plain employee", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/hrms/internal/retirement-accounts", headers: auth(["employee"]) });
    await app.close();
    expect(res.statusCode).toBe(403);
    expect(scopedReadMock).not.toHaveBeenCalled();
  });
});
