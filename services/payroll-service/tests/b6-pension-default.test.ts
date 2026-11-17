/** B6: the pension default comes from the tenant's statutoryPack; fails closed on a tenant-service outage. Pure (injected fetch). */
import { afterEach, describe, expect, it } from "vitest";
import { resolveTenantPensionDefault } from "../src/modules/pay-profiles/tenant-pension-default.js";
import { resetTenantDocIdentityCache, TenantIdentityUnavailableError, type FetchLike } from "../src/modules/deductor-config/tenant-identity.js";
import { planEmployeePay } from "../src/modules/pay-profiles/plan.js";
import { NO_ALLOWANCE_RULES } from "../src/modules/pay-profiles/allowance-rules.js";

const reply = (profileCode: string | null): FetchLike => async () => ({
  ok: true, status: 200, json: async () => ({ data: { name: "T", settings: {}, profileCode } }),
});
const down: FetchLike = async () => ({ ok: false, status: 503, json: async () => ({}) });
let n = 0;
const tid = () => `tenant-${++n}`;
afterEach(() => resetTenantDocIdentityCache());

describe("B6 tenant pension default", () => {
  it("govt profiles stay NPS; section8 resolves EPF from nonprofit_in", async () => {
    expect(await resolveTenantPensionDefault(tid(), { flagOn: true, fetchImpl: reply("govt_dept") })).toBe("NPS");
    expect(await resolveTenantPensionDefault(tid(), { flagOn: true, fetchImpl: reply("govt_small_office") })).toBe("NPS");
    expect(await resolveTenantPensionDefault(tid(), { flagOn: true, fetchImpl: reply("section8") })).toBe("EPF");
  });
  it("flag off makes no read and returns NPS (unchanged)", async () => {
    const boom: FetchLike = async () => { throw new Error("must not be called"); };
    expect(await resolveTenantPensionDefault(tid(), { flagOn: false, fetchImpl: boom })).toBe("NPS");
  });
  it("a tenant with no profileCode is the legacy govt default", async () => {
    expect(await resolveTenantPensionDefault(tid(), { flagOn: true, fetchImpl: reply(null) })).toBe("NPS");
  });
  it("fails closed on a tenant-service 503 (never a guessed scheme)", async () => {
    await expect(resolveTenantPensionDefault(tid(), { flagOn: true, fetchImpl: down })).rejects.toBeInstanceOf(TenantIdentityUnavailableError);
  });
  it("planEmployeePay: a recorded scheme wins; else the supplied default; else NPS", () => {
    const emp = { employeeNo: "E1", basicMinor: "100000", cityClass: "X", payProfile: null, engagement: null } as never;
    const run = (e: never, d?: "EPF") => {
      const r = planEmployeePay(e, "2026-11", 5000n, NO_ALLOWANCE_RULES, undefined, d);
      if (!r.ok) throw new Error(r.message);
      return r.plan.pensionScheme;
    };
    expect(run(emp)).toBe("NPS");
    expect(run(emp, "EPF")).toBe("EPF");
    expect(run({ ...(emp as object), pensionScheme: "GPF" } as never, "EPF")).toBe("GPF");
  });
});
