import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

// Loader mocks — the page fetches the contract, its three child resources and
// the vendor master in parallel.
const getContractByIdMock = vi.fn();
const getVendorOptionsMock = vi.fn();
const okList = { data: [], source: "api" as const, status: 200 };

vi.mock("../../../_data/loaders", () => ({
  getContractById: (id: string) => getContractByIdMock(id),
  getVendorOptions: () => getVendorOptionsMock(),
  getContractMilestones: () => Promise.resolve(okList),
  getContractBonds: () => Promise.resolve(okList),
  getContractObligations: () => Promise.resolve(okList),
}));

// Keep the client child components out of the server-render under test.
vi.mock("./MilestoneActions", () => ({ MilestoneActions: () => <div data-testid="milestones" /> }));
vi.mock("./BondActions", () => ({ BondActions: () => <div data-testid="bonds" /> }));
vi.mock("./ObligationsPanel", () => ({ ObligationsPanel: () => <div data-testid="obligations" /> }));
vi.mock("../../../_components/RaiseEOfficeNote", () => ({ RaiseEOfficeNote: () => <div data-testid="eoffice" /> }));

import ContractDetailPage from "./page";

const VENDOR_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const CONTRACT = {
  id: "c1",
  contractNo: "CON-2026-0001",
  title: "Road resurfacing",
  vendorId: VENDOR_ID,
  valueMinor: "500000",
  startDate: "2026-04-01",
  expiry: "2027-03-31",
  status: "approved",
};

describe("ContractDetailPage error/not-found distinction (GAP-CONTRACTS-DETAIL-01)", () => {
  beforeEach(() => {
    getContractByIdMock.mockReset();
    getVendorOptionsMock.mockReset();
    getVendorOptionsMock.mockResolvedValue({ data: [], source: "api", status: 200 });
  });

  it("a non-404 failure shows a retryable load error, NOT 'Contract not found'", async () => {
    getContractByIdMock.mockResolvedValue({ data: null, source: "error", status: 500 });
    render(await ContractDetailPage({ params: { id: "c1" } }));
    expect(screen.queryByText("Contract not found")).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /try again|retry/i }).length).toBeGreaterThan(0);
  });

  it("a 404 shows the honest 'Contract not found' state", async () => {
    getContractByIdMock.mockResolvedValue({ data: null, source: "error", status: 404 });
    render(await ContractDetailPage({ params: { id: "c1" } }));
    expect(screen.getByText("Contract not found")).toBeInTheDocument();
  });

  it("a clean null from the API (source=api) is treated as not found", async () => {
    getContractByIdMock.mockResolvedValue({ data: null, source: "api", status: 200 });
    render(await ContractDetailPage({ params: { id: "c1" } }));
    expect(screen.getByText("Contract not found")).toBeInTheDocument();
  });
});

describe("ContractDetailPage vendor name + status (GAP-CONTRACTS-DETAIL-04)", () => {
  beforeEach(() => {
    getContractByIdMock.mockReset();
    getVendorOptionsMock.mockReset();
  });

  it("renders the vendor NAME (not the raw UUID) when the vendor master resolves it", async () => {
    getContractByIdMock.mockResolvedValue({ data: CONTRACT, source: "api", status: 200 });
    getVendorOptionsMock.mockResolvedValue({
      data: [{ id: VENDOR_ID, name: "Acme Infra Pvt Ltd" }],
      source: "api",
      status: 200,
    });
    render(await ContractDetailPage({ params: { id: "c1" } }));
    expect(screen.getByText("Acme Infra Pvt Ltd")).toBeInTheDocument();
    // The full 36-char UUID must not appear anywhere in the DOM.
    expect(screen.queryByText(VENDOR_ID)).not.toBeInTheDocument();
  });

  it("colours an approved contract with the 'good' StatusPill tone", async () => {
    getContractByIdMock.mockResolvedValue({ data: CONTRACT, source: "api", status: 200 });
    getVendorOptionsMock.mockResolvedValue({ data: [], source: "api", status: 200 });
    render(await ContractDetailPage({ params: { id: "c1" } }));
    const pill = screen.getByText("Approved");
    expect(pill.className).toContain("good");
  });
});
