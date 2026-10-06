import { describe, it, expect, vi } from "vitest";

// _data.ts imports @/app/_data/apiClient, which pulls in next/headers (a
// server-only module that throws in jsdom). The mappers under test are pure
// and don't touch the loader, so stub the module to keep the test isolated.
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: vi.fn(),
}));

import {
  mapQuotaRows,
  mapSettingRows,
  mapSubscriptionRows,
  mapStewardshipRows,
  mapPositionRows,
  mapConsentRows,
  mapMigrationRows,
  mapCodeListRows,
  mapPlanRows,
  mapOrgHierarchyRows,
  mapOverviewRows,
} from "./_data";

describe("mapQuotaRows (GAP-TENANT-QUOTAS-01 / QUOTAS-02)", () => {
  it("shows used / limit with the resource name and a percent", () => {
    const [row] = mapQuotaRows({
      resources: [{ resource: "storage_gb", used: 40, limit: 100, usagePercent: 40, overLimit: false }],
    });
    expect(row.label).toBe("Storage gb");
    expect(row.sublabel).toBe("40 / 100");
    expect(row.meta).toBe("40%");
    expect(row.status).toBe("OK");
  });

  it("flags a near-limit resource with a readable status (text, not raw snake_case)", () => {
    const [row] = mapQuotaRows({
      resources: [{ resource: "api_calls_daily", used: 95, limit: 100, usagePercent: 95, overLimit: false }],
    });
    expect(row.status).toBe("Near limit");
  });

  it("flags an over-limit resource as Exceeded", () => {
    const [row] = mapQuotaRows({
      resources: [{ resource: "users", used: 7, limit: 7, usagePercent: 100, overLimit: true }],
    });
    expect(row.status).toBe("Exceeded");
  });

  it("shows '—' (never a fabricated 0) when a row has no numbers", () => {
    const [row] = mapQuotaRows({ resources: [{ resource: "documents" }] });
    expect(row.sublabel).toBe("—");
    expect(row.meta).toBeUndefined();
  });
});

describe("mapSettingRows (GAP-TENANT-SETTINGS-02 / SETTINGS-01)", () => {
  it("surfaces key, value AND description together (value never hidden behind description)", () => {
    const [row] = mapSettingRows([
      { key: "session.timeout_min", value: 30, description: "Idle timeout in minutes" },
    ]);
    expect(row.label).toBe("session.timeout_min");
    expect(row.sublabel).toBe("Idle timeout in minutes");
    expect(row.meta).toBe("30");
  });

  it("still shows the value when there is no description", () => {
    const [row] = mapSettingRows([{ key: "locale", value: "en-IN" }]);
    expect(row.meta).toBe("en-IN");
  });

  it("masks a secret-looking key's value so credentials are not printed", () => {
    const rows = mapSettingRows([
      { key: "smtp_password", value: "hunter2-super-secret" }, // gitleaks:allow
      { key: "api_token", value: "tok_live_abc123" }, // gitleaks:allow
    ]);
    expect(rows[0].meta).toBe("••••••••");
    expect(rows[0].meta).not.toContain("hunter2");
    expect(rows[1].meta).toBe("••••••••");
    expect(rows[1].meta).not.toContain("tok_live");
  });
});

describe("mapSubscriptionRows (GAP-TENANT-SUBSCRIPTIONS-01 / SUBSCRIPTIONS-05)", () => {
  it("leads with the plan name (not a raw opaque id) and shows the renewal date", () => {
    const [row] = mapSubscriptionRows({
      data: { planId: "11111111-1111-4000-8000-000000000001", planName: "PSU", status: "active", currentPeriodEnd: "2026-12-31T00:00:00.000Z" },
    });
    expect(row.label).toBe("PSU");
    expect(row.status).toBe("Active");
    expect(row.meta).toMatch(/Renews .*2026/);
  });

  it("renders a paise amount with the money formatter (no float math)", () => {
    const [row] = mapSubscriptionRows({
      data: { planId: "p1", planName: "Govt Department", amountPaise: "1234500", currency: "INR", currentPeriodEnd: "2026-01-01T00:00:00.000Z" },
    });
    expect(row.sublabel).toBe("₹12,345.00");
  });

  it("shows '—' for the renewal when no date is present", () => {
    const [row] = mapSubscriptionRows({ data: { planId: "p1", planName: "Small Office" } });
    expect(row.meta).toBe("—");
  });
});

describe("mapStewardshipRows (GAP-TENANT-STEWARDSHIP-01)", () => {
  it("shows the owner (role · office) in Meta for an owned domain", () => {
    const [row] = mapStewardshipRows({
      data: [{ id: "d1", name: "Citizen records", description: "PII domain", ownerRole: "DPO", ownerOffice: "District HQ", classification: "restricted" }],
    });
    expect(row.label).toBe("Citizen records");
    expect(row.sublabel).toBe("PII domain");
    expect(row.meta).toBe("DPO · District HQ");
    expect(row.status).toBe("Restricted");
  });

  it("shows 'Unassigned' when a domain has no owner", () => {
    const [row] = mapStewardshipRows({ data: [{ id: "d2", name: "Finance ledgers" }] });
    expect(row.meta).toBe("Unassigned");
  });
});

describe("mapPositionRows (GAP-TENANT-POSITIONS-01)", () => {
  it("renders a Vacant status when the post has no incumbent (filled strength 0)", () => {
    const [row] = mapPositionRows({
      data: [{ id: "pos1", title: "Junior Engineer", code: "JE-01", grade: "L7", status: "active", sanctionedStrength: 2, filledStrength: 0 }],
    });
    expect(row.label).toBe("Junior Engineer");
    expect(row.sublabel).toBe("JE-01 · L7");
    expect(row.status).toBe("Vacant");
    expect(row.meta).toBe("0 / 2 filled");
  });

  it("keeps the real status when the post is filled", () => {
    const [row] = mapPositionRows({
      data: [{ id: "pos2", title: "Section Officer", code: "SO-02", status: "active", sanctionedStrength: 1, filledStrength: 1 }],
    });
    expect(row.status).toBe("Active");
    expect(row.meta).toBe("1 / 1 filled");
  });
});

describe("mapConsentRows (GAP-TENANT-CONSENT-EXCHANGE-01 / 02)", () => {
  it("shows purpose + requesting dept as label (never raw UUID)", () => {
    const [row] = mapConsentRows({
      data: [{ id: "11111111-1111-4000-8000-000000000001", purposeKey: "identity_verification", requestingDept: "Revenue Office", dataCategories: ["aadhaar", "name"], validTo: "2027-06-30T00:00:00.000Z", status: "requested" }],
    });
    expect(row.label).toBe("Identity verification — Revenue Office");
    expect(row.sublabel).toBe("aadhaar, name");
    expect(row.status).toBe("Requested");
    expect(row.meta).toMatch(/Expires.*2027/);
    expect(row.label).not.toMatch(/^[0-9a-f]{8}-/i);
  });

  it("falls back to 'Consent request N' when no purpose is present", () => {
    const [row] = mapConsentRows({ data: [{ id: "abc", status: "active" }] });
    expect(row.label).toBe("Consent request 1");
  });
});

describe("mapMigrationRows (GAP-TENANT-DATA-MIGRATION-01)", () => {
  it("shows records migrated and error count as meta", () => {
    const [row] = mapMigrationRows({
      data: [{ id: "m1", status: "completed", recordsMigrated: 450, errors: [{ r: 1 }], entities: ["citizens", "properties"] }],
    });
    expect(row.label).toBe("citizens, properties");
    expect(row.status).toBe("Completed");
    expect(row.meta).toBe("450 migrated · 1 error");
  });

  it("shows dry-run qualifier in status", () => {
    const [row] = mapMigrationRows({
      data: [{ id: "m2", status: "pending", dryRun: true, entities: ["assets"], recordsMigrated: 0 }],
    });
    expect(row.status).toBe("Pending (dry run)");
  });
});

describe("mapCodeListRows (GAP-TENANT-CODE-LISTS-01)", () => {
  it("shows code list name, description and system/custom status", () => {
    const [row] = mapCodeListRows({
      data: [{ id: "cl-1", code: "GENDER", name: "Gender", description: "Legal gender codes", isSystem: true }],
    });
    expect(row.label).toBe("Gender");
    expect(row.sublabel).toBe("Legal gender codes");
    expect(row.status).toBe("System");
    expect(row.meta).toBe("GENDER");
  });
});

describe("mapPlanRows (GAP-TENANT-PLANS-01)", () => {
  it("price renders as paise-correct money (no float math); shows module count", () => {
    const [row] = mapPlanRows({
      data: [{ id: "p1", code: "PSU", name: "PSU Plan", edition: "psu", priceMinor: 149900, billingCycle: "annual", enabledModules: ["hrms", "finance", "procurement"] }],
    });
    expect(row.label).toBe("PSU Plan");
    expect(row.sublabel).toMatch(/₹1,499/);
    expect(row.sublabel).toContain("/ annual");
    expect(row.status).toBe("Psu");
    expect(row.meta).toBe("3 modules");
  });

  it("never divides money by a float (paise are integer)", () => {
    const [row] = mapPlanRows({ data: [{ id: "p2", name: "Basic", priceMinor: "99" }] });
    // 99 paise = ₹0.99
    expect(row.sublabel).toMatch(/₹0\.99/);
  });
});

describe("mapOrgHierarchyRows (GAP-TENANT-ORG-HIERARCHY-01)", () => {
  it("indents child units under their parent (hierarchy visible in flat table)", () => {
    const rows = mapOrgHierarchyRows({
      data: [
        { id: "root", parentId: null, name: "Municipality", type: "municipal_body", level: 1 },
        { id: "zone-a", parentId: "root", name: "Zone A", type: "zone", level: 2 },
        { id: "ward-1", parentId: "zone-a", name: "Ward 1", type: "ward", level: 3 },
      ],
    });
    expect(rows[0].label).toBe("Municipality");
    expect(rows[1].label).toMatch(/↳\s*Zone A/);
    expect(rows[2].label).toMatch(/↳\s*Ward 1/);
    // Deeper units have more indentation
    expect(rows[2].label.indexOf("↳")).toBeGreaterThan(rows[1].label.indexOf("↳"));
  });
});

describe("mapOverviewRows (GAP-TENANT-OVERVIEW-01 / OVERVIEW-02)", () => {
  it("shows the tenant name (never a UUID) and edition/type/residency", () => {
    const [row] = mapOverviewRows({
      data: { id: "t1", name: "District Collectorate Pune", code: "MH-PNE-001", type: "govt_dept", status: "active", residency: "india" },
    });
    expect(row.label).toBe("District Collectorate Pune");
    expect(row.sublabel).toMatch(/Govt dept/);
    expect(row.sublabel).toContain("India");
    expect(row.status).toBe("Active");
    expect(row.meta).toBe("MH-PNE-001");
  });

  it("shows 'Unnamed' when the tenant name is absent (never the raw UUID)", () => {
    const [row] = mapOverviewRows({ data: { id: "11111111-1111-4000-8000-000000000001" } });
    expect(row.label).toBe("Unnamed");
    expect(row.label).not.toMatch(/^[0-9a-f]{8}-/i);
  });
});