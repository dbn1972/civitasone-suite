/**
 * M8 — gateway: a tenant sold HRMS without Recruitment still reaches APAR and the employee data-reveal, and is blocked
 * from the recruitment surface; a full-HR tenant (every current tenant) is unchanged.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { checkModuleEnabled, _test } from "../src/module-guard.js";
import { resolveHrmsModuleKey, HRMS_NON_CORE_KEYS, WORKFORCE_CORE_KEY, RECRUITMENT_KEY } from "../src/hrms-subroute-map.js";

const TID = "11111111-2222-4000-8000-0000000000c8";
const fakeReq = (): any => ({ headers: { "x-tenant-id": TID }, id: "req-m8", log: { warn() {} } });
const fakeReply = (): any => { const r: any = { _code: 200, _body: null }; r.code = (n: number) => ((r._code = n), r); r.send = (b: any) => ((r._body = b), r); return r; };
const project = (keys: string[]) => vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ configured: true, mode: "enforce", data: keys.map((name) => ({ name })) }) })));

// What the composition projection gives: HR without Recruitment = every HRMS key except hrms-recruitment.
const HR_NO_RECRUITMENT = [WORKFORCE_CORE_KEY, ...HRMS_NON_CORE_KEYS.filter((k) => k !== RECRUITMENT_KEY)];
const HR_FULL = [WORKFORCE_CORE_KEY, ...HRMS_NON_CORE_KEYS];

beforeEach(() => {
  _test.moduleCache.clear();
  _test.lastKnownMode.clear();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.stubEnv("COMPOSITION_ENFORCEMENT", "on");
});
afterEach(() => vi.restoreAllMocks());

const allowed = async (path: string) => { _test.moduleCache.clear(); return checkModuleEnabled(fakeReq(), fakeReply(), "hrms", path); };

describe("APAR and data-reveal do not ride the recruitment key", () => {
  it("resolve to their own keys", () => {
    for (const p of ["/api/v1/hrms/apar", "/api/v1/hrms/apar/9/finalise", "/api/v1/hr/apar", "/api/v1/hrms/appraisals"]) expect(resolveHrmsModuleKey(p), p).toBe("hrms-appraisal");
    for (const p of ["/api/v1/hrms/pii/reveal", "/api/v1/hr/pii/reveal", "/api/v1/hrms/employees/1"]) expect(resolveHrmsModuleKey(p), p).toBe(WORKFORCE_CORE_KEY);
    // applicant contact reveal is recruitment data and legitimately stays on the recruitment key
    expect(resolveHrmsModuleKey("/api/v1/hrms/applications/1/reveal-contact")).toBe(RECRUITMENT_KEY);
  });
});

describe("HR without Recruitment (enforce mode)", () => {
  it("reaches APAR, appraisals, the employee data-reveal, leave, attendance and the core surface", async () => {
    for (const path of ["/api/v1/hrms/apar", "/api/v1/hrms/apar/9/finalise", "/api/v1/hrms/appraisals", "/api/v1/hrms/pii/reveal", "/api/v1/hrms/employees/1", "/api/v1/hrms/leave/apply", "/api/v1/hrms/attendance/mark", "/api/v1/hrms/me/profile"]) {
      project(HR_NO_RECRUITMENT);
      expect(await allowed(path), path).toBe(true);
    }
  });

  it("is blocked from the recruitment surface, including the public careers routes", async () => {
    for (const path of ["/api/v1/hrms/job-openings", "/api/v1/hrms/requisitions", "/api/v1/hrms/candidates/9", "/api/v1/hrms/applications/1/reveal-contact", "/api/v1/hrms/talent-pool", "/api/v1/careers/vacancies"]) {
      project(HR_NO_RECRUITMENT);
      expect(await allowed(path), path).toBe(false);
    }
  });
});

describe("parity: a full-HR tenant (every current tenant) reaches everything it did", () => {
  it("allows the recruitment surface, APAR and the data-reveal", async () => {
    for (const path of ["/api/v1/hrms/job-openings", "/api/v1/hrms/applications/1/reveal-contact", "/api/v1/careers/vacancies", "/api/v1/hrms/apar", "/api/v1/hrms/pii/reveal"]) {
      project(HR_FULL);
      expect(await allowed(path), path).toBe(true);
    }
  });
});
