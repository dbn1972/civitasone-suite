/**
 * Tenant-profile S5 — composition applied on tenant.tenant.onboarded for non-govt profiles.
 * AUTHORED, NOT YET RUN (real DB; run in a quiet window). Govt golden: flag off AND on => no composition rows.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";

const { sqlClient } = await import("../src/shared/db.js");
const { queue } = await import("../src/shared/infra.js");
const { registerProfileOnboardConsumer, NON_GOVT_PROFILES } = await import("../src/modules/composition/profile-onboard.js");

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

describe("onboarded consumer — govt golden (byte-identical)", () => {
  it("govt_dept, flag OFF => nothing written", async () => {
    await onboarded(T.govtOff, "govt_dept", "govt");
    const s = await state(T.govtOff);
    expect(s.profile).toHaveLength(0); expect(s.ents).toHaveLength(0); expect(s.mode).toHaveLength(0);
  });
  it("govt_dept and govt_small_office, flag ON => nothing written", async () => {
    process.env.TENANT_PROFILES_ENABLED = "true";
    await onboarded(T.govtOn, "govt_dept", "govt");
    await onboarded(T.smallOfficeGovt, "govt_small_office", "govt");
    for (const t of [T.govtOn, T.smallOfficeGovt]) {
      const s = await state(t);
      expect(s.profile).toHaveLength(0); expect(s.ents).toHaveLength(0); expect(s.mode).toHaveLength(0);
    }
  });
  it("govt profiles are never in the allow-list", () => {
    expect(NON_GOVT_PROFILES.has("govt_dept")).toBe(false);
    expect(NON_GOVT_PROFILES.has("govt_small_office")).toBe(false);
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
});
