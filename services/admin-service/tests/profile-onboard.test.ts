/**
 * Tenant-profile S5 (+B2 govt_small_office) — composition applied on tenant.tenant.onboarded for catalogue composeOnOnboard profiles.
 * AUTHORED, NOT YET RUN (real DB; run in a quiet window). Govt golden: flag off AND on => no composition rows.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";

const { sqlClient } = await import("../src/shared/db.js");
const { queue } = await import("../src/shared/infra.js");
const { registerProfileOnboardConsumer } = await import("../src/modules/composition/profile-onboard.js");

const { composesOnOnboard } = await import("@civitasone/tenant-profile");

const ADMIN = "11111111-eeee-4000-8000-000000000001";
const T = {
  govtOff: "cccccccc-dddd-4000-8000-0000000005a1",
  govtOn: "cccccccc-dddd-4000-8000-0000000005a2",
  smallOfficeGovt: "cccccccc-dddd-4000-8000-0000000005a3",
  section8: "cccccccc-dddd-4000-8000-0000000005a4",
  msme: "cccccccc-dddd-4000-8000-0000000005a5",
  psu: "cccccccc-dddd-4000-8000-0000000005a6",
  manual: "cccccccc-dddd-4000-8000-0000000005a7",
  operator: "cccccccc-dddd-4000-8000-0000000005a8",
  noProfile: "cccccccc-dddd-4000-8000-0000000005a9",
};
const ALL = Object.values(T);
let prevFlag: string | undefined;

async function drain(): Promise<void> {
  const q = queue as unknown as { drain?: () => Promise<void> };
  expect(typeof q.drain).toBe("function");
  await q.drain!();
}
async function scoped<R>(t: string, fn: (tx: any) => Promise<R>): Promise<R> {
  return sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${t}, true)`;
    return fn(tx);
  }) as Promise<R>;
}
async function clean(): Promise<void> {
  for (const t of ALL) {
    await scoped(t, async (tx) => {
      await tx`DELETE FROM composition.tenant_enforcement_mode WHERE tenant_id = ${t}`;
      await tx`DELETE FROM composition.tenant_entitlement WHERE tenant_id = ${t}`;
      await tx`DELETE FROM composition.tenant_profile WHERE tenant_id = ${t}`;
    });
  }
}
async function onboarded(tenantId: string, profileCode: string, edition = profileCode): Promise<void> {
  await queue.publish("tenant.tenant.onboarded", {
    messageId: randomUUID(), type: "tenant.tenant.onboarded", tenantId, actorId: ADMIN, correlationId: randomUUID(), schemaVersion: "1.0",
    payload: { tenantId, adminEmail: "a@x.in", adminName: "A", edition, profileCode },
  } as never);
  await drain();
}
const state = (t: string) =>
  scoped(t, async (tx) => ({
    profile: await tx`SELECT profile_code FROM composition.tenant_profile WHERE tenant_id = ${t}`,
    ents: await tx`SELECT module_id FROM composition.tenant_entitlement WHERE tenant_id = ${t}`,
    mode: await tx`SELECT mode FROM composition.tenant_enforcement_mode WHERE tenant_id = ${t}`,
  }));

beforeAll(async () => {
  prevFlag = process.env.TENANT_PROFILES_ENABLED;
  registerProfileOnboardConsumer(queue);
  await queue.start();
});
afterAll(async () => {
  await clean();
  if (prevFlag === undefined) delete process.env.TENANT_PROFILES_ENABLED; else process.env.TENANT_PROFILES_ENABLED = prevFlag;
  await queue.stop();
  await sqlClient.end();
});
beforeEach(clean);
afterEach(() => { delete process.env.TENANT_PROFILES_ENABLED; });

describe("migration 0062", () => {
  it("relabels small_office, adds section8, leaves rule_packs / default_modules and govt untouched", async () => {
    const [so] = await sqlClient`SELECT label, rule_packs, default_modules FROM composition.org_profile WHERE code = 'small_office'`;
    expect(so!.label).toBe("Small business / MSME");
    expect(so!.default_modules).toHaveLength(10); // composition.test.ts depends on this
    expect((so!.rule_packs as Record<string, string>).audit_profile).toBe("fcra_12a_80g"); // display label kept
    const s8 = await sqlClient`SELECT code FROM composition.org_profile WHERE code = 'section8'`;
    expect(s8).toHaveLength(1);
    const bundles = await sqlClient`SELECT code FROM composition.module_bundle WHERE code IN ('section8','small_office','psu')`;
    expect(bundles.map((b) => b.code).sort()).toEqual(["psu", "section8", "small_office"]);
    const [govt] = await sqlClient`SELECT default_modules FROM composition.org_profile WHERE code = 'govt_dept'`;
    expect(govt!.default_modules.length).toBeGreaterThan(20);
  });
});

describe("bundle / profile drift guard", () => {
  it.each(["section8", "small_office", "psu", "govt_small_office"])("module_bundle.%s equals org_profile.default_modules", async (code) => {
    const [b] = await sqlClient`SELECT module_ids FROM composition.module_bundle WHERE code = ${code}`;
    const [p] = await sqlClient`SELECT default_modules FROM composition.org_profile WHERE code = ${code}`;
    expect([...b!.module_ids].sort()).toEqual([...p!.default_modules].sort());
  });
});

describe("onboarded consumer — govt golden (byte-identical)", () => {
  it("govt_dept, flag OFF => nothing written", async () => {
    await onboarded(T.govtOff, "govt_dept", "govt");
    const s = await state(T.govtOff);
    expect(s.profile).toHaveLength(0); expect(s.ents).toHaveLength(0); expect(s.mode).toHaveLength(0);
  });
  it("govt_dept, flag ON => nothing written", async () => {
    process.env.TENANT_PROFILES_ENABLED = "true";
    await onboarded(T.govtOn, "govt_dept", "govt");
    const s = await state(T.govtOn);
    expect(s.profile).toHaveLength(0); expect(s.ents).toHaveLength(0); expect(s.mode).toHaveLength(0);
  });
  it("govt_small_office, flag OFF => nothing written", async () => {
    await onboarded(T.smallOfficeGovt, "govt_small_office", "govt");
    const s = await state(T.smallOfficeGovt);
    expect(s.profile).toHaveLength(0); expect(s.ents).toHaveLength(0); expect(s.mode).toHaveLength(0);
  });
  it("govt_small_office, flag ON => composes its 17-module bundle in shadow mode (B2, migration 0064)", async () => {
    process.env.TENANT_PROFILES_ENABLED = "true";
    await onboarded(T.smallOfficeGovt, "govt_small_office", "govt");
    const s = await state(T.smallOfficeGovt);
    expect(s.profile.map((r) => r.profile_code)).toEqual(["govt_small_office"]);
    expect(s.mode.map((r) => r.mode)).toEqual(["shadow"]);
    const [b] = await sqlClient`SELECT module_ids FROM composition.module_bundle WHERE code = 'govt_small_office'`;
    const ents = s.ents.map((r) => r.module_id as string);
    for (const m of b!.module_ids as string[]) expect(ents).toContain(m);
    expect(ents).not.toContain("recruitment");
  });
  it("govt_dept is never in the allow-list; govt_small_office is (catalogue data)", () => {
    expect(composesOnOnboard("govt_dept")).toBe(false);
    expect(composesOnOnboard("govt_small_office")).toBe(true);
  });
});

describe("onboarded consumer — non-govt segments", () => {
  it("flag OFF => even section8 is a no-op", async () => {
    await onboarded(T.section8, "section8");
    const s = await state(T.section8);
    expect(s.profile).toHaveLength(0); expect(s.ents).toHaveLength(0); expect(s.mode).toHaveLength(0);
  });
  it.each([["section8", T.section8], ["small_office", T.msme], ["psu", T.psu]] as const)(
    "flag ON, %s => bundle applied, enforcement shadow", async (code, tenant) => {
      process.env.TENANT_PROFILES_ENABLED = "true";
      await onboarded(tenant, code);
      const s = await state(tenant);
      const [def] = await sqlClient`SELECT default_modules FROM composition.org_profile WHERE code = ${code}`;
      expect(s.profile[0]!.profile_code).toBe(code);
      expect(s.ents.map((e: any) => e.module_id).sort()).toEqual([...def!.default_modules].sort());
      expect(s.mode[0]!.mode).toBe("shadow");
    },
  );
  it("is idempotent: a redelivery / second event leaves the same state", async () => {
    process.env.TENANT_PROFILES_ENABLED = "true";
    await onboarded(T.section8, "section8");
    const first = await state(T.section8);
    await onboarded(T.section8, "section8");
    expect(await state(T.section8)).toEqual(first);
  });
  it("does not clobber a manual onboard or an operator-set enforcement mode", async () => {
    process.env.TENANT_PROFILES_ENABLED = "true";
    await scoped(T.manual, (tx) => tx`INSERT INTO composition.tenant_profile (tenant_id, profile_code, applied_by) VALUES (${T.manual}, 'govt_dept', ${ADMIN})`);
    await onboarded(T.manual, "psu");
    expect((await state(T.manual)).profile[0]!.profile_code).toBe("govt_dept");
    expect((await state(T.manual)).ents).toHaveLength(0);

    await scoped(T.operator, (tx) => tx`INSERT INTO composition.tenant_enforcement_mode (tenant_id, mode, updated_by) VALUES (${T.operator}, 'enforce', ${ADMIN})`);
    await onboarded(T.operator, "small_office");
    expect((await state(T.operator)).mode[0]!.mode).toBe("enforce");
  });
  it("does not wipe existing entitlements of a tenant that has no profile row", async () => {
    process.env.TENANT_PROFILES_ENABLED = "true";
    await scoped(T.noProfile, (tx) => tx`INSERT INTO composition.tenant_entitlement (tenant_id, module_id, source, created_by) VALUES (${T.noProfile}, 'employee', 'user', ${ADMIN}), (${T.noProfile}, 'finance', 'user', ${ADMIN})`);
    await onboarded(T.noProfile, "psu");
    const s = await state(T.noProfile);
    expect(s.ents.map((e: any) => e.module_id).sort()).toEqual(["employee", "finance"]);
    expect(s.profile).toHaveLength(0);
    expect(s.mode).toHaveLength(0);
  });
});
