import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("@/lib/auth/roleGuard", () => ({ getSessionRoles: () => ["super_admin"] }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/admin",
  useSearchParams: () => new URLSearchParams(),
}));

import TenantProvisionPage from "./tenant-provision/page";
import { InvoicesTable } from "./invoices/InvoicesTable";

// GAP-ADMIN-TENANT-PROVISION-01/-02
describe("tenant-provision", () => {
  it("does not promise a wizard, links to the onboarding queue, and has no fake readiness", () => {
    render(TenantProvisionPage());
    expect(screen.queryByText(/Step-by-step wizard/)).not.toBeInTheDocument();
    expect(screen.getByText(/wizard is not available yet/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open onboarding queue" })).toHaveAttribute("href", "/admin/onboarding");
    expect(screen.queryByText("Templates Ready")).not.toBeInTheDocument();
    expect(screen.queryByText("Template Ready")).not.toBeInTheDocument();
    const src = readFileSync(join(__dirname, "tenant-provision/page.tsx"), "utf8");
    expect(src).not.toMatch(/"Template Ready"/);
  });

  it("the admin hub tile no longer advertises a wizard", () => {
    const src = readFileSync(join(__dirname, "page.tsx"), "utf8");
    expect(src).not.toMatch(/onboarding wizard/);
  });
});

// GAP-ADMIN-INVOICES-02
describe("InvoicesTable", () => {
  it("renders billing-service paise as rupees with lakh grouping", () => {
    render(
      <InvoicesTable
        invoices={[{ id: "inv-1", periodMonth: "2026-09", status: "issued", totalMinor: "11800000", paidMinor: "0", outstandingMinor: "11800000", issuedAt: "2026-09-30T00:00:00Z" }]}
        source="api"
      />,
    );
    expect(screen.getAllByText(/1,18,000/).length).toBeGreaterThan(0);
    expect(screen.queryByText("11800000")).not.toBeInTheDocument();
  });

  // GAP-ADMIN-INVOICES-06: the invoice number opens the detail page.
  it("links each invoice number to its detail page", () => {
    render(
      <InvoicesTable
        invoices={[{ id: "5e7e1000-0000-4000-8000-000000000001", periodMonth: "2026-09", status: "issued", totalMinor: "100", paidMinor: "0", outstandingMinor: "100", issuedAt: "2026-09-30T00:00:00Z" }]}
        source="api"
      />,
    );
    expect(screen.getByRole("link", { name: "5e7e1000-0000-4000-8000-000000000001" })).toHaveAttribute("href", "/admin/invoices/5e7e1000-0000-4000-8000-000000000001");
  });
});

// GAP-ADMIN-BULK-SCAN-02: the bulk-scan placeholder copy test was removed -- the page is now a real, wired feature (see bulk-scan/_components tests).
