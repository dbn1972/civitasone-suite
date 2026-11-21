/**
 * Finance review fixes: (1) FY labels on the budget write bodies must be a real consecutive
 * "YYYY-YY" (2031-99 was accepted by the legacy regex-only validators); (2) accounts_officer
 * approves/rejects bills so must also be able to READ the bill register/detail.
 * DB-free: the role guard and Zod run before any query.
 */
import { describe, it, expect } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { createBudgetBody } from "../src/modules/budget/validators.js";
import { createProposalBody } from "../src/modules/budget/formulation-validators.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-3030-4000-8000-000000000a01";
const tok = (roles: string[]) => ({ authorization: `Bearer ${signToken({ sub: "00000000-aaaa-4000-8000-000000000a01", tid: TENANT, roles, sid: "fy-bill" }, SECRET)}` });
const HEAD = "00000000-bbbb-4000-8000-000000000a01";

describe("budget FY label validation", () => {
  it.each(["2031-99", "2026-28", "2026-2", "26-27", "abcd-ef"])("createBudgetBody rejects fy %s", (fy) => {
    expect(createBudgetBody.safeParse({ headId: HEAD, fy, beMinor: 100000 }).success).toBe(false);
  });
  it("createBudgetBody accepts a real consecutive FY", () => {
    expect(createBudgetBody.safeParse({ headId: HEAD, fy: "2026-27", beMinor: 100000 }).success).toBe(true);
    expect(createBudgetBody.safeParse({ headId: HEAD, fy: "2099-00", beMinor: 100000 }).success).toBe(true);
  });
  it("proposal body rejects an impossible FY", () => {
    const r = createProposalBody.safeParse({ fy: "2031-99", deptCode: "D1", headId: HEAD, proposedMinor: 100 });
    expect(r.success).toBe(false);
  });
  it("POST /v1/finance/budget-allocations rejects fy 2031-99 with 400", async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({ method: "POST", url: "/v1/finance/budget-allocations", headers: tok(["finance_officer"]), payload: { headId: HEAD, fy: "2031-99", allocatedMinor: 100 } });
      expect(res.statusCode).toBe(400);
    } finally { await app.close(); }
  });
});

describe("accounts_officer bill access", () => {
  it.each(["/v1/finance/bills", `/v1/finance/bills/${HEAD}`])("GET %s is not forbidden for accounts_officer", async (url) => {
    const app = await buildApp();
    try {
      const res = await app.inject({ method: "GET", url, headers: tok(["accounts_officer"]) });
      expect(res.statusCode).not.toBe(403);
    } finally { await app.close(); }
  });
  it("a role outside the reader set is still forbidden", async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({ method: "GET", url: "/v1/finance/bills", headers: tok(["hr_officer"]) });
      expect(res.statusCode).toBe(403);
    } finally { await app.close(); }
  });
});
