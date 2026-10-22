import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const loader = vi.hoisted(() => ({ getCurrentTenantOrgType: vi.fn() }));
vi.mock("@/app/_data/loaders", () => ({ getCurrentTenantOrgType: loader.getCurrentTenantOrgType }));

import NewGrievanceLayout from "./layout";
import { useTenantDpoEmail } from "./DpoEmailContext";

function Probe() {
  return <span data-testid="dpo">{String(useTenantDpoEmail())}</span>;
}

async function renderLayout() {
  render(await NewGrievanceLayout({ children: <Probe /> }));
  return screen.getByTestId("dpo").textContent;
}

describe("grievance DPO address resolution (per-tenant, global fallback)", () => {
  beforeEach(() => loader.getCurrentTenantOrgType.mockReset());

  it("provides the tenant's own settings.dpoEmail", async () => {
    loader.getCurrentTenantOrgType.mockResolvedValue({ data: { tenantId: "t", orgType: null, settings: { dpoEmail: "dpo@office.gov.in" } }, source: "api" });
    expect(await renderLayout()).toBe("dpo@office.gov.in");
  });

  it("provides null (so the global fallback applies) when unset, invalid or the lookup failed", async () => {
    loader.getCurrentTenantOrgType.mockResolvedValue({ data: { tenantId: "t", orgType: null, settings: {} }, source: "api" });
    expect(await renderLayout()).toBe("null");
    document.body.innerHTML = "";
    loader.getCurrentTenantOrgType.mockResolvedValue({ data: { tenantId: "t", orgType: null, settings: { dpoEmail: "javascript:alert(1)" } }, source: "api" });
    expect(await renderLayout()).toBe("null");
    document.body.innerHTML = "";
    // The real loader never throws: a failed lookup resolves to its empty fallback.
    loader.getCurrentTenantOrgType.mockResolvedValue({ data: { tenantId: null, orgType: null, settings: {} }, source: "error" });
    expect(await renderLayout()).toBe("null");
  });
});
