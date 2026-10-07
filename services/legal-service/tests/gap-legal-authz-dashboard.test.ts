import { describe, it, expect, afterEach } from "vitest";
import { signToken } from "@civitasone/auth";

/**
 * Gap-ledger backend checks for module `legal`:
 *  - GAP-LEGAL-HOME-01 / GAP-LEGAL-CASES-DETAIL-06: finance_admin must be
 *    rejected (403) by legal-service routes — case detail, create case,
 *    counsel briefs, dashboard — independent of the web layout gate.
 *  - GAP-LEGAL-DASHBOARD-01: the dashboard payload exposes disposedCases and
 *    totalCases so the web KPI is real, not fabricated.
 */

const JWT_SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "11111111-aaaa-4000-8000-000000000031";
const ACTOR = "00000000-aaaa-4000-8000-000000000031";
const CASE_ID = "22222222-bbbb-4000-8000-000000000031";

function makeToken(roles: string[]): string {
  return signToken({ sub: ACTOR, tid: TENANT, roles, sid: "sess-test" }, JWT_SECRET, 3600);
}

async function app() {
  const { buildApp } = await import("../src/app.js");
  return buildApp();
}

describe("legal authz: finance_admin is excluded (GAP-LEGAL-HOME-01, GAP-LEGAL-CASES-DETAIL-06)", () => {
  let a: Awaited<ReturnType<typeof app>> | null = null;
  afterEach(async () => { if (a) { await a.close(); a = null; } });

  it("403s finance_admin on GET case detail", async () => {
    a = await app();
    const res = await a.inject({
      method: "GET",
      url: `/v1/legal/cases/${CASE_ID}`,
      headers: { authorization: `Bearer ${makeToken(["finance_admin"])}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it("403s finance_admin on POST create case", async () => {
    a = await app();
    const res = await a.inject({
      method: "POST",
      url: "/v1/legal/cases",
      headers: { authorization: `Bearer ${makeToken(["finance_admin"])}` },
      payload: { caseNo: "WP/1/2026", title: "X v Y", court: "High Court" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("403s finance_admin on the dashboard", async () => {
    a = await app();
    const res = await a.inject({
      method: "GET",
      url: "/v1/legal/dashboard",
      headers: { authorization: `Bearer ${makeToken(["finance_admin"])}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it("allows legal_officer on the dashboard", async () => {
    a = await app();
    const res = await a.inject({
      method: "GET",
      url: "/v1/legal/dashboard",
      headers: { authorization: `Bearer ${makeToken(["legal_officer"])}` },
    });
    expect(res.statusCode).toBe(200);
  });
});

describe("legal dashboard payload (GAP-LEGAL-DASHBOARD-01)", () => {
  let a: Awaited<ReturnType<typeof app>> | null = null;
  afterEach(async () => { if (a) { await a.close(); a = null; } });

  it("exposes disposedCases and totalCases numeric fields", async () => {
    a = await app();
    const res = await a.inject({
      method: "GET",
      url: "/v1/legal/dashboard",
      headers: { authorization: `Bearer ${makeToken(["legal_officer"])}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(typeof body.disposedCases).toBe("number");
    expect(typeof body.totalCases).toBe("number");
  });
});
