import { describe, it, expect } from "vitest";
import { mapRows, mapInstallModules, mapSiloProvisions } from "./_data";

// GAP-INSTALL-{MODULES,SILOS,STAGES}-01 (FORMAT): the generic install row
// mapper must not surface a raw ISO timestamp or a UUID fragment where a
// human-readable value exists.
describe("install mapRows (FORMAT)", () => {
  it("formats an ISO timestamp in meta as an Indian date, not the raw string", () => {
    const [row] = mapRows([{ id: "11111111-2222-3333-4444-555555555555", name: "Stage A", updatedAt: "2026-03-01T10:00:00Z" }]);
    expect(row.meta).toBe("01 Mar 2026");
    expect(row.meta).not.toMatch(/T\d{2}:\d{2}/);
  });

  it("uses the row code as the identifier when present", () => {
    const [row] = mapRows([{ id: "11111111-2222-3333-4444-555555555555", code: "STAGE-3", name: "Domain pack" }]);
    expect(row.id).toBe("STAGE-3");
  });

  it("renders a non-date code meta unchanged", () => {
    const [row] = mapRows([{ id: "x", name: "Thing", currency: "INR" }]);
    expect(row.meta).toBe("INR");
  });

  it("leaves rows without meta undefined (table renders em-dash)", () => {
    const [row] = mapRows([{ id: "x", name: "Thing" }]);
    expect(row.meta).toBeUndefined();
  });
});

// GAP-INSTALL-MODULES-04 (CONTENT): surface the REAL manifest fields.
describe("mapInstallModules (MODULES-04)", () => {
  it("marks a foundation module 'Always on' and lists its dependencies", () => {
    const rows = mapInstallModules({
      data: [
        { id: "finance", name: "Finance", description: "GL and bills", requires: ["identity", "audit"] },
        { id: "install", name: "Install Wizard", description: "Setup", requires: [], foundation: true },
      ],
    });
    const finance = rows.find((r) => r.id === "finance")!;
    expect(finance.status).toBe("Optional");
    expect(finance.meta).toContain("identity");
    expect(finance.meta).toContain("audit");
    const install = rows.find((r) => r.id === "install")!;
    expect(install.status).toBe("Always on");
  });

  it("shows a sub-module count when a module has sub-modules but no deps", () => {
    const [row] = mapInstallModules({
      data: [{ id: "hrms", name: "HR", description: "People", requires: [], subModules: [{ id: "a" }, { id: "b" }] }],
    });
    expect(row.meta).toBe("2 sub-modules");
  });

  it("falls back to the generic mapper for a non-manifest payload", () => {
    const [row] = mapInstallModules({ data: [{ id: "x", name: "Row", status: "ready" }] });
    expect(row.label).toBe("Row");
    expect(row.status).toBe("ready");
  });
});

// GAP-INSTALL-HOME-01: the wizard reads typed steps (loaders.getInstallSteps,
// InstallStepSummarySchema), not the generic mapRows. Pin that a real
// /v1/install/steps payload (stageToStep output) parses with title, stepNo and
// isRequired populated.
import { InstallStepSummaryListSchema } from "@civitasone/schemas/web";
describe("install steps payload shape", () => {
  it("populates title, stepNo and isRequired", () => {
    const [step] = InstallStepSummaryListSchema.parse([
      { id: "s1", stepNo: 1, title: "Create tenant", status: "pending" },
    ]);
    expect(step).toMatchObject({ title: "Create tenant", stepNo: 1, isRequired: true });
  });
});

// GAP-INSTALL-SILOS-04: free-text infrastructure detail must never be rendered.
describe("mapSiloProvisions (allow-listed)", () => {
  it("drops description / errorMessage carrying infra hostnames", () => {
    const rows = mapSiloProvisions({
      data: [
        {
          id: "silo-1",
          tenantCode: "OFFICE-A",
          region: "ap-south-1",
          status: "failed",
          description: "db-host.internal",
          errorMessage: "connect ECONNREFUSED db-host.internal:5432",
        },
      ],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ label: "OFFICE-A", sublabel: "ap-south-1", status: "failed" });
    const rendered = JSON.stringify(rows);
    expect(rendered).not.toContain("db-host.internal");
    expect(rendered).not.toContain("ECONNREFUSED");
  });
});
