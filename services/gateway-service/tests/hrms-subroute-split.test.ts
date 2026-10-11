/**
 * HRMS sub-route key split — gateway unit tests (ST-M01-04b, FF-03, D-ST-23/24).
 *
 * Two layers:
 *   1. the pure resolver `resolveHrmsModuleKey` — every unambiguous non-core
 *      prefix resolves to its own `hrms-<module>` key; core / shared / unknown
 *      prefixes resolve to `workforce_core` (the "never over-block core" rule);
 *   2. the path-aware `checkModuleEnabled` — a standalone-shaped allow-list
 *      (`workforce_core` only) BLOCKS leave / attendance / recruitment /
 *      payroll-facing while ALLOWING the core surface, in enforce mode; and the
 *      pre-split behaviour is unchanged in off mode and for callers that pass no
 *      pathname (backward-compat).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { checkModuleEnabled, _test } from "../src/module-guard.js";
import {
  resolveHrmsModuleKey,
  HRMS_SUBROUTE_TO_KEY,
  HRMS_NON_CORE_KEYS,
  WORKFORCE_CORE_KEY,
} from "../src/hrms-subroute-map.js";

const TID = "11111111-2222-4000-8000-0000000000ab";

function fakeReq(tid?: string): any {
  return { headers: tid ? { "x-tenant-id": tid } : {}, id: "req-04b", log: { warn() {} } };
}
function fakeReply(): any {
  const r: any = { _code: 200, _body: null };
  r.code = (n: number) => ((r._code = n), r);
  r.send = (b: any) => ((r._body = b), r);
  return r;
}
function mockFetch(payload: unknown): void {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => payload })));
}

beforeEach(() => {
  _test.moduleCache.clear();
  _test.lastKnownMode.clear();
  _test.resetShadowCount();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
afterEach(() => vi.restoreAllMocks());

// ───────────────────────────────────────────────────────────────────────────
// 1. resolver
// ───────────────────────────────────────────────────────────────────────────
describe("resolveHrmsModuleKey", () => {
  it("maps each unambiguous non-core prefix to its own key", () => {
    const cases: Array<[string, string]> = [
      ["/api/v1/hrms/leave/apply", "hrms-leave"],
      ["/api/v1/hrms/leave-requests/42", "hrms-leave"],
      ["/api/v1/hrms/comp-off", "hrms-leave"],
      ["/api/v1/hrms/attendance/mark", "hrms-attendance"],
      ["/api/v1/hrms/shifts", "hrms-attendance"],
      ["/api/v1/hrms/wfh-requests", "hrms-attendance"],
      ["/api/v1/hrms/recruitment/openings", "hrms-recruitment"],
      ["/api/v1/hrms/candidates/9", "hrms-recruitment"],
      ["/api/v1/hrms/offers", "hrms-recruitment"],
      ["/api/v1/hrms/appraisals", "hrms-appraisal"],
      ["/api/v1/hrms/apar", "hrms-appraisal"],
      ["/api/v1/hrms/pay-matrix", "hrms-payroll"],
      ["/api/v1/hrms/medical/claims", "hrms-payroll"],
      ["/api/v1/hrms/ltc-claims", "hrms-payroll"],
      ["/api/v1/hrms/training/programs", "hrms-training"],
      ["/api/v1/hrms/learning", "hrms-training"],
      ["/api/v1/hrms/social/feed", "hrms-social"],
      ["/api/v1/hrms/kudos", "hrms-social"],
      ["/api/v1/hrms/disciplinary/1", "hrms-disciplinary"],
      ["/api/v1/hrms/grievances", "hrms-disciplinary"],
      ["/api/v1/hrms/contracts", "hrms-contracts"],
      ["/api/v1/hrms/consultant-invoices", "hrms-contracts"],
      ["/api/v1/hrms/assessment", "hrms-assessment"],
      ["/api/v1/hrms/attempts", "hrms-assessment"],
      ["/api/v1/hrms/id-cards", "hrms-id-cards"],
      ["/api/v1/hrms/visiting-card", "hrms-id-cards"],
      ["/api/v1/hrms/ai/predict", "hrms-ai"],
      ["/api/v1/hrms/rti", "hrms-rti"],
      ["/api/v1/hrms/workforce/plan", "hrms-workforce-planning"],
      ["/api/v1/hrms/board-intake", "hrms-board-intake"],
      ["/api/v1/hrms/competency", "hrms-competency"],
      ["/api/v1/hrms/me/profile", "hrms-self-service"],
    ];
    for (const [path, key] of cases) {
      expect(resolveHrmsModuleKey(path), path).toBe(key);
    }
  });

  it("resolves CORE and SHARED prefixes to workforce_core (never over-block)", () => {
    for (const path of [
      "/api/v1/hrms/employees/1",
      "/api/v1/hrms/departments",
      "/api/v1/hrms/designations",
      "/api/v1/hrms/service-book/1",
      "/api/v1/hrms/seniority",
      "/api/v1/hrms/holds",
      "/api/v1/hrms/sanctioned-posts",
      "/api/v1/hrms/manpower",
      "/api/v1/hrms/lifecycle/transfer",
      "/api/v1/hrms/transfers",
      "/api/v1/hrms/onboarding", // shared core(lifecycle)/gap-features → core
      "/api/v1/hrms/deputation", // shared core(lifecycle)/deputation → core
      "/api/v1/hrms/loans", // shared core(employee)/payroll-facing → core
      "/api/v1/hrms/analytics",
      "/api/v1/hrms/reports",
      "/api/v1/hrms/dashboard",
      "/api/v1/hrms", // bare surface
      "/api/v1/hrms/", // trailing slash, no segment
      "/api/v1/hrms/unknown-future-prefix",
    ]) {
      expect(resolveHrmsModuleKey(path), path).toBe(WORKFORCE_CORE_KEY);
    }
  });

  it("handles the /hr and /careers aliases and query/encoding", () => {
    expect(resolveHrmsModuleKey("/api/v1/hr/leave/apply")).toBe("hrms-leave");
    expect(resolveHrmsModuleKey("/api/v1/careers/offers")).toBe("hrms-recruitment");
    expect(resolveHrmsModuleKey("/api/v1/hrms/leave?from=2026-01-01")).toBe("hrms-leave");
    expect(resolveHrmsModuleKey("/api/v1/hr/employees/1")).toBe(WORKFORCE_CORE_KEY);
  });

  it("a non-HRMS path never matches (returns core default only via guard gating)", () => {
    // The resolver is only called for HRMS routes; a non-HRMS path has no
    // hrms/hr/careers segment, so it falls to the core default.
    expect(resolveHrmsModuleKey("/api/v1/finance/vouchers")).toBe(WORKFORCE_CORE_KEY);
  });

  it("every mapped value is a distinct non-core key, all < 45 chars (D-ST-19)", () => {
    for (const key of HRMS_NON_CORE_KEYS) {
      expect(key.startsWith("hrms-")).toBe(true);
      // dot-to-dash length budget: keys already use dashes, so length is the bound
      expect(key.length).toBeLessThan(45);
    }
    expect(new Set(Object.values(HRMS_SUBROUTE_TO_KEY)).size).toBe(HRMS_NON_CORE_KEYS.length);
    expect(HRMS_NON_CORE_KEYS).not.toContain("workforce_core");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 2. path-aware checkModuleEnabled — the standalone shape
// ───────────────────────────────────────────────────────────────────────────
describe("path-aware guard: standalone allow-list (workforce_core only)", () => {
  beforeEach(() => vi.stubEnv("COMPOSITION_ENFORCEMENT", "on"));

  // A standalone tenant's projection: workforce_core + smarttransfer + workflow.
  const standalone = () =>
    mockFetch({ configured: true, mode: "enforce", data: [{ name: "workforce_core" }, { name: "smarttransfer" }, { name: "workflow" }] });

  it("BLOCKS leave, attendance, recruitment and payroll-facing at the gateway", async () => {
    for (const [path, key] of [
      ["/api/v1/hrms/leave/apply", "hrms-leave"],
      ["/api/v1/hrms/attendance/mark", "hrms-attendance"],
      ["/api/v1/hrms/recruitment/openings", "hrms-recruitment"],
      ["/api/v1/hrms/pay-matrix", "hrms-payroll"],
    ] as const) {
      _test.moduleCache.clear();
      standalone();
      const reply = fakeReply();
      const allowed = await checkModuleEnabled(fakeReq(TID), reply, "hrms", path);
      expect(allowed, `must block ${path}`).toBe(false);
      expect(reply._code).toBe(403);
      expect(reply._body.code).toBe("MODULE_DISABLED");
      expect(reply._body.message, `message names ${key}`).toContain(key);
    }
  });

  it("ALLOWS the core Workforce Core surface for the same standalone tenant", async () => {
    for (const path of [
      "/api/v1/hrms/employees/1",
      "/api/v1/hrms/departments",
      "/api/v1/hrms/service-book/1",
      "/api/v1/hrms/sanctioned-posts",
      "/api/v1/hrms/seniority",
    ]) {
      _test.moduleCache.clear();
      standalone();
      const reply = fakeReply();
      expect(await checkModuleEnabled(fakeReq(TID), reply, "hrms", path), `must allow ${path}`).toBe(true);
      expect(reply._code).toBe(200);
    }
  });
});

describe("path-aware guard: a full-HRMS tenant reaches every sub-key", () => {
  beforeEach(() => vi.stubEnv("COMPOSITION_ENFORCEMENT", "on"));

  // Projection for a tenant with the full HR set (workforce_core + every sub-key).
  const fullHrms = () =>
    mockFetch({
      configured: true,
      mode: "enforce",
      data: [{ name: WORKFORCE_CORE_KEY }, ...HRMS_NON_CORE_KEYS.map((name) => ({ name }))],
    });

  it("allows leave, recruitment, payroll-facing AND the core surface", async () => {
    for (const path of [
      "/api/v1/hrms/leave/apply",
      "/api/v1/hrms/recruitment/openings",
      "/api/v1/hrms/pay-matrix",
      "/api/v1/hrms/employees/1",
    ]) {
      _test.moduleCache.clear();
      fullHrms();
      expect(await checkModuleEnabled(fakeReq(TID), fakeReply(), "hrms", path), path).toBe(true);
    }
  });
});

describe("off mode + backward-compat (no regression)", () => {
  it("off mode: a standalone tenant that is OFF is NOT blocked on a resolved-but-absent sub-key via ambiguous-signal fail-open — but a KNOWN allow-list still 403s a disabled key", async () => {
    // off-mode contract is UNCHANGED: a known allow-list (configured:true) that
    // omits the resolved sub-key 403s even in off (this was always the case for
    // a known-disabled module). The grandfather backfill is what prevents this
    // for real pre-existing tenants (they are granted the sub-keys); here we
    // simply assert the mode semantics are not altered by the split.
    vi.stubEnv("COMPOSITION_ENFORCEMENT", "on");
    mockFetch({ configured: true, mode: "off", data: [{ name: "workforce_core" }] });
    const reply = fakeReply();
    expect(await checkModuleEnabled(fakeReq(TID), reply, "hrms", "/api/v1/hrms/leave/apply")).toBe(false);
    expect(reply._code).toBe(403);
    // the core surface is allowed in off too
    _test.moduleCache.clear();
    mockFetch({ configured: true, mode: "off", data: [{ name: "workforce_core" }] });
    expect(await checkModuleEnabled(fakeReq(TID), fakeReply(), "hrms", "/api/v1/hrms/employees/1")).toBe(true);
  });

  it("backward-compat: with NO pathname the legacy coarse `hrms` key is used", async () => {
    // A direct caller that passes only the route name keeps the pre-split
    // behaviour: the whole HRMS surface rides the single `hrms` key.
    vi.stubEnv("COMPOSITION_ENFORCEMENT", "on");
    mockFetch({ configured: true, mode: "enforce", data: [{ name: "hrms" }] });
    expect(await checkModuleEnabled(fakeReq(TID), fakeReply(), "hrms")).toBe(true);
    _test.moduleCache.clear();
    mockFetch({ configured: true, mode: "enforce", data: [{ name: "workforce_core" }] });
    const reply = fakeReply();
    // workforce_core-only, no pathname → coarse `hrms` key → not in set → 403
    expect(await checkModuleEnabled(fakeReq(TID), reply, "hrms")).toBe(false);
    expect(reply._code).toBe(403);
  });
});
