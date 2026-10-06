import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const mockLoad = vi.fn();
vi.mock("../../../../../_data/loaders", () => ({
  getProcurementPOById: (id: string) => mockLoad(id),
}));
// AmendForm is a client component with its own fetches — stub it so the server
// page test asserts only the load/guard/header behaviour.
vi.mock("./AmendForm", () => ({
  AmendForm: () => <div data-testid="amend-form" />,
}));

import POAmendPage from "./page";

const PO_UUID = "55555555-5555-5555-5555-555555555555";

function po(over: Record<string, unknown> = {}) {
  return {
    id: PO_UUID,
    poNo: "PO/2026/0042",
    vendor: "Acme Supplies",
    orderDate: "2026-06-01",
    deliveryDate: "2026-07-01",
    totalAmount: 500000,
    status: "approved",
    lineItems: [],
    ...over,
  };
}

describe("POAmendPage — AMEND-01 loads the PO", () => {
  beforeEach(() => mockLoad.mockReset());

  it("shows the PO number and vendor, not the raw UUID", async () => {
    mockLoad.mockResolvedValue({ data: po(), source: "api" });
    render(await POAmendPage({ params: { id: PO_UUID } }));
    expect(screen.getByText("PO/2026/0042")).toBeInTheDocument();
    expect(screen.getAllByText("Acme Supplies").length).toBeGreaterThanOrEqual(1);
    // The raw UUID is not shown as the subtitle any more.
    expect(screen.queryByText(PO_UUID)).not.toBeInTheDocument();
    expect(screen.getByTestId("amend-form")).toBeInTheDocument();
  });

  it("shows a not-amendable message (no form) for a cancelled PO", async () => {
    mockLoad.mockResolvedValue({ data: po({ status: "cancelled" }), source: "api" });
    render(await POAmendPage({ params: { id: PO_UUID } }));
    expect(screen.getByText("This PO cannot be amended")).toBeInTheDocument();
    expect(screen.queryByTestId("amend-form")).not.toBeInTheDocument();
  });

  it("shows an error state (not 'not found') when the load errored", async () => {
    mockLoad.mockResolvedValue({ data: null, source: "error" });
    render(await POAmendPage({ params: { id: PO_UUID } }));
    expect(screen.queryByText("Purchase order not found")).not.toBeInTheDocument();
  });
});
