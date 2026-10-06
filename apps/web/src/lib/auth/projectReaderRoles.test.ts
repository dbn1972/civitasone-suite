import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PROJECT_READER_ROLES } from "./roleGuard";

// The beneficiaries page is served by project-service mock-elimination-routes.ts
// (NOT project/routes.ts), so the web gate must mirror THAT module's READER_ROLES.
describe("PROJECT_READER_ROLES (GAP-PROJECTS-BENEFICIARIES-01)", () => {
  it("is exactly the beneficiaries endpoint role set", () => {
    expect([...PROJECT_READER_ROLES].sort()).toEqual(
      ["audit_officer", "finance_officer", "project_admin", "project_officer", "super_admin", "tenant_admin"],
    );
  });
  it("admits tenant_admin/project_admin and excludes project_manager (service would 403)", () => {
    expect(PROJECT_READER_ROLES).toContain("tenant_admin");
    expect(PROJECT_READER_ROLES).toContain("project_admin");
    expect(PROJECT_READER_ROLES).not.toContain("project_manager");
  });
  it("stays in lockstep with the service source", () => {
    const src = readFileSync(
      resolve(__dirname, "../../../../../services/project-service/src/modules/project/mock-elimination-routes.ts"),
      "utf8",
    );
    const m = /const READER_ROLES = \[([^\]]*)\]/.exec(src);
    expect(m).not.toBeNull();
    const svc = m![1]!.split(",").map((s) => s.trim().replace(/"/g, "")).filter(Boolean).sort();
    expect([...PROJECT_READER_ROLES].sort()).toEqual(svc);
  });
});
