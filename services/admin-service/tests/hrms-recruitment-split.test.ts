/**
 * M8 — composition: Recruitment can be offered per client.
 *
 *  1. `career` (Transfer & Promotion) has no recruitment routes of its own; today it borrows the `hrms-recruitment`
 *     gateway key, so a client sold career WITHOUT recruitment reaches the whole recruitment surface. With
 *     HRMS_RECRUITMENT_SPLIT=on career projects to workforce_core (where its transfer/promotion routes really live)
 *     and only the `recruitment` module unlocks the recruitment key. Default (unset) = today's projection, byte for byte.
 *  2. The `hr_no_recruitment` bundle (migration 0061) is the one-click offer; the existing `hr` bundle is untouched.
 */
import { describe, it, expect, afterEach, afterAll } from "vitest";
const { toGatewayKeys, COMPOSITION_TO_GATEWAY_KEYS } = await import("../src/modules/composition/gateway-map.js");
const { sqlClient } = await import("../src/shared/db.js");
const { buildRegistry, resolveComposition } = await import("../src/modules/composition/domain.js");
const repo = await import("../src/modules/composition/repo.js");

afterEach(() => { delete process.env.HRMS_RECRUITMENT_SPLIT; });
const { buildApp } = await import("../src/app.js");
const { signToken } = await import("@civitasone/auth");
const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const BT = "cccccccc-dddd-4000-8000-0000000000d9";
afterAll(async () => { await sqlClient.end(); });

const HR_NO_REC = ["employee", "attendance", "leave", "appraisal", "career", "ess"];

describe("career no longer borrows the recruitment key (flagged)", () => {
  it("default: projection is unchanged - career still maps to hrms-recruitment", () => {
    expect(COMPOSITION_TO_GATEWAY_KEYS.career).toEqual(["hrms-recruitment"]);
    expect(toGatewayKeys(HR_NO_REC)).toContain("hrms-recruitment");
  });

  it("HRMS_RECRUITMENT_SPLIT=on: HR without Recruitment gets APAR, data-reveal (core) and no recruitment key", () => {
    process.env.HRMS_RECRUITMENT_SPLIT = "on";
    const keys = toGatewayKeys(HR_NO_REC);
    expect(keys).not.toContain("hrms-recruitment");
    expect(keys).toEqual(expect.arrayContaining(["workforce_core", "hrms-appraisal", "hrms-leave", "hrms-attendance", "hrms-self-service"]));
  });

  it("HRMS_RECRUITMENT_SPLIT=on: only the recruitment module unlocks the recruitment key", () => {
    process.env.HRMS_RECRUITMENT_SPLIT = "on";
    expect(toGatewayKeys(["employee", "recruitment"])).toContain("hrms-recruitment");
    expect(toGatewayKeys(["career"])).not.toContain("hrms-recruitment");
  });

  // a resolved tenant that has career always has employee (its hard dependency), which projects workforce_core
  it("parity: every module set that includes recruitment projects identically with the flag on or off; sets without it differ only by the borrowed key", () => {
    const hr = ["employee", "attendance", "leave", "recruitment", "appraisal", "career", "ess"];
    const others = Object.keys(COMPOSITION_TO_GATEWAY_KEYS);
    const sets: string[][] = [hr, [...hr, "payroll", "finance"], ["recruitment"], ["employee", "career", "recruitment"], others, [], ["finance"], HR_NO_REC, ["employee", "career"]];
    for (const s of sets) {
      delete process.env.HRMS_RECRUITMENT_SPLIT;
      const off = toGatewayKeys(s);
      process.env.HRMS_RECRUITMENT_SPLIT = "on";
      const on = toGatewayKeys(s);
      if (s.includes("recruitment") || !s.includes("career")) expect(on, s.join()).toEqual(off);
      else expect(off.filter((k) => !on.includes(k)), s.join()).toEqual(["hrms-recruitment"]);
    }
  });
});

describe("hr_no_recruitment bundle (migration 0061)", () => {
  it("exists, lists HR without recruitment, and resolves without pulling recruitment in", async () => {
    const bundles = await repo.loadBundles("cccccccc-dddd-4000-8000-0000000000d8");
    const b = bundles.find((x) => x.code === "hr_no_recruitment");
    expect(b).toBeTruthy();
    expect([...b!.moduleIds].sort()).toEqual([...HR_NO_REC].sort());
    const reg = buildRegistry(await repo.loadRegistry("cccccccc-dddd-4000-8000-0000000000d8"));
    const ids = resolveComposition(reg, b!.moduleIds).moduleIds;
    expect(ids).not.toContain("recruitment");
    expect(ids).toEqual(expect.arrayContaining(["employee", "appraisal"]));
  });

  it("the existing hr bundle is untouched", async () => {
    const hr = (await repo.loadBundles("cccccccc-dddd-4000-8000-0000000000d8")).find((x) => x.code === "hr");
    expect([...hr!.moduleIds].sort()).toEqual(["employee", "attendance", "leave", "recruitment", "appraisal", "career", "ess"].sort());
  });
});

describe("hr_no_recruitment is unsellable while the split is off", () => {
  const enable = async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/admin/composition/bundles/hr_no_recruitment/enable",
      headers: { authorization: `Bearer ${signToken({ sub: "11111111-eeee-4000-8000-0000000000d9", tid: BT, roles: ["tenant_admin"], sid: "m8" }, SECRET, 3600)}` } });
    await app.close();
    return r;
  };
  it("flag off (default): refused with 409 and nothing is enabled", async () => {
    const r = await enable();
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("BUNDLE_REQUIRES_RECRUITMENT_SPLIT");
    const rows = await sqlClient.begin(async (tx) => { await tx`SELECT set_config('app.tenant_id', ${BT}, true)`; return tx`SELECT module_id FROM composition.tenant_entitlement WHERE tenant_id = ${BT}`; });
    expect(rows.length).toBe(0);
  });
  it("flag on: the bundle enables HR without recruitment", async () => {
    process.env.HRMS_RECRUITMENT_SPLIT = "on";
    const r = await enable();
    expect(r.statusCode).toBe(200);
    const mods = (r.json().modules as Array<{ id: string }>).map((m) => m.id);
    expect(mods).toEqual(expect.arrayContaining(["employee", "appraisal", "career"]));
    expect(mods).not.toContain("recruitment");
    await sqlClient.begin(async (tx) => { await tx`SELECT set_config('app.tenant_id', ${BT}, true)`; await tx`DELETE FROM composition.tenant_entitlement WHERE tenant_id = ${BT}`; });
  });
});
