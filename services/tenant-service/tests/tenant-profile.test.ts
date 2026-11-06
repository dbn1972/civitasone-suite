/**
 * Tenant-type profile switch (docs/design/TENANT-PROFILE-SWITCH.md), slice S1: tenant-service.
 * Profile assignment on onboarding, the created/onboarded event payloads, the read API block, and migration 0035.
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { tenantTenantCreated } from "@civitasone/events/contracts";
import { db } from "../src/shared/db.js";
import { tenants } from "../src/modules/tenant/schema.js";
import { resolveProfileCode, withProfile } from "../src/modules/tenant/profile.js";
import { tenantCreatedEventPayload } from "../src/modules/tenant/events.js";
import { onboardTenantBody } from "../src/modules/tenant/validators.js";
import { HttpError } from "../src/shared/context.js";

const ACTOR = randomUUID();
const VIEW = {
  id: "5b1f3c60-7a4e-4f0b-9d2a-3e8c1a6d4b11", tenantId: "5b1f3c60-7a4e-4f0b-9d2a-3e8c1a6d4b11",
  name: "Office of the Block Development and Panchayat Officer, Sohna", domain: "bdpo-sohna.haryana.gov.in",
  edition: "govt" as const, status: "draft" as const, region: "ap-south-1", residency: "IN", settings: {}, version: 1,
};

describe("resolveProfileCode", () => {
  it("no request gives the edition default: govt -> govt_dept, every other edition -> the same word", () => {
    expect(resolveProfileCode("govt", undefined, false)).toBe("govt_dept");
    expect(resolveProfileCode("psu", undefined, false)).toBe("psu");
    expect(resolveProfileCode("small_office", undefined, true)).toBe("small_office");
  });
  it("naming the default explicitly is accepted with the flag off", () => {
    expect(resolveProfileCode("govt", "govt_dept", false)).toBe("govt_dept");
  });
  it("govt_small_office needs the flag, and only for edition govt", () => {
    expect(() => resolveProfileCode("govt", "govt_small_office", false)).toThrow(/PROFILES_NOT_ENABLED|not enabled/);
    expect(resolveProfileCode("govt", "govt_small_office", true)).toBe("govt_small_office");
    expect(() => resolveProfileCode("small_office", "govt_small_office", true)).toThrow(HttpError);
    expect(() => resolveProfileCode("govt", "govt_nonexistent", true)).toThrow(/not available/);
  });
  it("owner decision 2: PSU, private, NGO and cooperative accept no non-default profile", () => {
    for (const e of ["psu", "private", "ngo", "cooperative"]) {
      expect(() => resolveProfileCode(e, "govt_small_office", true), e).toThrow(HttpError);
    }
  });
  it("the onboard body accepts an optional, well-formed profile", () => {
    const base = { name: "BDPO Sohna", domain: "bdpo-sohna.haryana.gov.in", edition: "govt", region: "ap-south-1", residency: "IN", adminEmail: "bdpo.sohna@haryana.gov.in", adminName: "Rajesh Kumar" };
    expect(onboardTenantBody.parse(base).profile).toBeUndefined();
    expect(onboardTenantBody.parse({ ...base, profile: "govt_small_office" }).profile).toBe("govt_small_office");
    expect(() => onboardTenantBody.parse({ ...base, profile: "Govt Small Office" })).toThrow();
  });
});

describe("read API block", () => {
  it("a view without a stored profile reads the edition default and a resolved block (existing tenants)", () => {
    const v = withProfile(VIEW, false);
    expect(v.profileCode).toBe("govt_dept");
    expect(v.profile).toMatchObject({ code: "govt_dept", active: false, defaultBillHead: "fixed" });
    expect(v.profile!.settings).toMatchObject({ budgetControl: "mandatory", coaTemplate: "govt", accountingBasis: "cash" });
  });
  it("govt_small_office is mandatory, wizard-chosen bill head, active only with the flag on", () => {
    const off = withProfile({ ...VIEW, profileCode: "govt_small_office" }, false);
    const on = withProfile({ ...VIEW, profileCode: "govt_small_office" }, true);
    expect(off.profile!.active).toBe(false);
    expect(on.profile).toMatchObject({ active: true, defaultBillHead: "wizard" });
    expect(on.profile!.settings.budgetControl).toBe("mandatory");
  });
  it("an MSME small_office tenant stays on the legacy settings even with the flag on", () => {
    const v = withProfile({ ...VIEW, edition: "small_office", profileCode: "small_office" }, true);
    expect(v.profile!.settings).toMatchObject({ budgetControl: "mandatory", coaTemplate: "govt", accountingBasis: "cash" });
  });
});

describe("tenant.tenant.created payload", () => {
  it("carries profileCode and profileVersion and still validates against the contract", () => {
    const p = tenantCreatedEventPayload({ ...VIEW, profileCode: "govt_small_office" });
    expect(p).toMatchObject({ profileCode: "govt_small_office", profileVersion: "1", edition: "govt" });
    expect(tenantTenantCreated.validate(p)).toEqual({ ok: true });
  });
  it("defaults profileCode from the edition when the source has none", () => {
    expect(tenantCreatedEventPayload(VIEW).profileCode).toBe("govt_dept");
  });
  it("a v1.0 event without profile fields still validates", () => {
    expect(tenantTenantCreated.validate({ tenantId: VIEW.id, plan: "govt" })).toEqual({ ok: true });
  });
});

describe("migration 0035 (profile_code)", () => {
  afterAll(async () => { /* rows are per-tenant random ids; the disposable DB is discarded */ });
  const insertTenant = async (edition: string, profileCode?: string) => {
    const id = randomUUID();
    await runWithTenant(id, () => db.transaction(async (tx) => {
      await tx.insert(tenants).values({
        id, tenantId: id, name: `Office ${id.slice(0, 6)}`, domain: `o-${id.slice(0, 8)}.example.gov.in`, edition,
        region: "ap-south-1", residency: "IN", createdBy: ACTOR, updatedBy: ACTOR, version: 1,
        ...(profileCode ? { profileCode } : {}),
      });
    }));
    const rows = await runWithTenant(id, () => db.transaction(async (tx) => tx.select({ p: tenants.profileCode }).from(tenants).where(eq(tenants.id, id))));
    return rows[0]!.p;
  };
  it("a row inserted without profile_code (an older binary) gets govt_dept for govt and the edition name otherwise", async () => {
    expect(await insertTenant("govt")).toBe("govt_dept");
    expect(await insertTenant("psu")).toBe("psu");
    expect(await insertTenant("small_office")).toBe("small_office");
  });
  it("an explicit profile is kept", async () => {
    expect(await insertTenant("govt", "govt_small_office")).toBe("govt_small_office");
  });
  it("the format check refuses a malformed code", async () => {
    await expect(insertTenant("govt", "Govt Small Office")).rejects.toThrow();
  });
  it("the column is NOT NULL, and an explicit NULL is filled by the trigger before that check", async () => {
    const [col] = await db.execute(sql`select is_nullable from information_schema.columns where table_schema = 'tenant' and table_name = 'tenants' and column_name = 'profile_code'`) as unknown as Array<{ is_nullable: string }>;
    expect(col!.is_nullable).toBe("NO");
    const id = randomUUID();
    await runWithTenant(id, () => db.transaction(async (tx) => {
      await tx.execute(sql`insert into tenant.tenants (id, tenant_id, name, domain, edition, region, residency, created_by, updated_by, version, profile_code)
        values (${id}, ${id}, 'Office', ${`n-${id.slice(0, 8)}.example.gov.in`}, 'govt', 'ap-south-1', 'IN', ${ACTOR}, ${ACTOR}, 1, NULL)`);
    }));
  });
});
