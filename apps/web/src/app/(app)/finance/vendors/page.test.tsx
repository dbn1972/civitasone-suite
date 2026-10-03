import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const getFinanceVendors = vi.hoisted(() => vi.fn());
const tableProps = vi.hoisted(() => ({ last: null as unknown }));
vi.mock("@/app/_data/loaders", () => ({ getFinanceVendors: (...a: unknown[]) => getFinanceVendors(...a) }));
const session = vi.hoisted(() => ({ roles: [] as string[] }));
vi.mock("@/lib/auth/roleGuard", () => ({ getSessionRoles: () => session.roles }));
vi.mock("./VendorsTable", () => ({ VendorsTable: (p: unknown) => { tableProps.last = p; return <div>vendors-table</div>; } }));

import VendorsPage from "./page";

describe("VendorsPage (GAP-FINANCE-VENDORS-02 / review MEDIUM-3)", () => {
  it("masks PAN on the server: the client table never receives a full PAN", async () => {
    getFinanceVendors.mockResolvedValue({
      data: [{ id: "v1", name: "Acme", category: "Goods", pan: "ABCDE1234F", gstin: null, status: "active", ratingDisplay: "x" }],
      source: "api",
    });
    render(await VendorsPage());
    const props = tableProps.last as { vendors: { pan: string }[] };
    expect(props.vendors[0].pan).toBe("ABCDE****F");
    expect(JSON.stringify(props)).not.toContain("ABCDE1234F");
  });

  // GAP-FINANCE-VENDORS-01: a real pending count, not a permanent placeholder.
  it("counts pending vendors in the Pending Approval card", async () => {
    getFinanceVendors.mockResolvedValue({
      data: [
        { id: "a", name: "A", category: "x", pan: null, gstin: null, status: "pending", ratingDisplay: "x" },
        { id: "b", name: "B", category: "x", pan: null, gstin: null, status: "pending", ratingDisplay: "x" },
        { id: "c", name: "C", category: "x", pan: null, gstin: null, status: "active", ratingDisplay: "x" },
      ],
      source: "api",
    });
    render(await VendorsPage());
    expect(screen.getByText("Pending Approval").closest(".stat")).toHaveTextContent("2");
    expect(screen.queryByText(/not tracked yet/)).not.toBeInTheDocument();
  });

  // GAP-FINANCE-VENDORS-02: the CSV export is role-gated.
  it("passes canExport only for export roles", async () => {
    getFinanceVendors.mockResolvedValue({ data: [], source: "api" });
    session.roles = ["audit_officer"];
    render(await VendorsPage());
    expect((tableProps.last as { canExport: boolean }).canExport).toBe(false);
    session.roles = ["finance_officer"];
    render(await VendorsPage());
    expect((tableProps.last as { canExport: boolean }).canExport).toBe(true);
  });
});
