import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const getFinanceVendors = vi.hoisted(() => vi.fn());
const tableProps = vi.hoisted(() => ({ last: null as unknown }));
vi.mock("@/app/_data/loaders", () => ({ getFinanceVendors: (...a: unknown[]) => getFinanceVendors(...a) }));
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
    expect(screen.getByText("Pending Approval (not tracked yet)")).toBeInTheDocument();
  });
});
