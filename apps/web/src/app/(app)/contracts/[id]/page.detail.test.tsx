import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { createTranslator } from "next-intl";
import en from "@/messages/en.json";

// Server component: resolve namespaced keys against the real en messages.
vi.mock("next-intl/server", () => ({
  getTranslations: async (ns: string) => createTranslator({ locale: "en", messages: en as never, namespace: ns as never }),
}));

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

// UX-R5: names come from the ONE shared record-reference resolver (vendor + officers), not the vendor master.
const resolveRecordRefsMock = vi.fn();
vi.mock("@/lib/records/recordRefs", () => ({ resolveRecordRefs: (req: unknown) => resolveRecordRefsMock(req) }));
const emptyRefs = () => ({ people: new Map(), vendors: new Map() });

// Keep the client child components out of the server-render under test; capture the gating props.
const childProps: Record<string, Record<string, unknown>> = {};
vi.mock("./MilestoneActions", () => ({ MilestoneActions: (p: Record<string, unknown>) => { childProps.milestones = p; return <div data-testid="milestones" />; } }));
vi.mock("./BondActions", () => ({ BondActions: (p: Record<string, unknown>) => { childProps.bonds = p; return <div data-testid="bonds" />; } }));
vi.mock("./ObligationsPanel", () => ({ ObligationsPanel: (p: Record<string, unknown>) => { childProps.obligations = p; return <div data-testid="obligations" />; } }));
vi.mock("../../../_components/RaiseEOfficeNote", () => ({ RaiseEOfficeNote: (p: Record<string, unknown>) => { childProps.eoffice = p; return <div data-testid="eoffice" />; } }));
vi.mock("./ContractLifecycleActions", () => ({ ContractLifecycleSection: () => <button type="button">Lifecycle action</button> }));

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
    resolveRecordRefsMock.mockReset();
    resolveRecordRefsMock.mockResolvedValue(emptyRefs());
  });

  it("a non-404 failure shows a retryable load error, NOT 'Contract not found'", async () => {
    getContractByIdMock.mockResolvedValue({ data: null, source: "error", status: 500 });
    render(await ContractDetailPage({ params: Promise.resolve({ id: "c1" }) }));
    expect(screen.queryByText("Contract not found")).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /try again|retry/i }).length).toBeGreaterThan(0);
  });

  it("a 404 shows the honest 'Contract not found' state", async () => {
    getContractByIdMock.mockResolvedValue({ data: null, source: "error", status: 404 });
    render(await ContractDetailPage({ params: Promise.resolve({ id: "c1" }) }));
    expect(screen.getByText("Contract not found")).toBeInTheDocument();
  });

  it("a clean null from the API (source=api) is treated as not found", async () => {
    getContractByIdMock.mockResolvedValue({ data: null, source: "api", status: 200 });
    render(await ContractDetailPage({ params: Promise.resolve({ id: "c1" }) }));
    expect(screen.getByText("Contract not found")).toBeInTheDocument();
  });
});

describe("ContractDetailPage vendor name + status (GAP-CONTRACTS-DETAIL-04)", () => {
  beforeEach(() => {
    getContractByIdMock.mockReset();
    getVendorOptionsMock.mockReset();
    resolveRecordRefsMock.mockReset();
    resolveRecordRefsMock.mockResolvedValue(emptyRefs());
  });

  it("an unresolved vendor reads as an honest unresolved label, never the UUID", async () => {
    getContractByIdMock.mockResolvedValue({ data: CONTRACT, source: "api", status: 200 });
    render(await ContractDetailPage({ params: Promise.resolve({ id: "c1" }) }));
    expect(screen.getAllByText("Name not available (ID ending 3301)").length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toContain(VENDOR_ID);
    expect(document.body.textContent).not.toContain("Unknown vendor");
  });

  it("renders the vendor NAME (not the raw UUID) when the shared resolver resolves it", async () => {
    getContractByIdMock.mockResolvedValue({ data: CONTRACT, source: "api", status: 200 });
    resolveRecordRefsMock.mockResolvedValue({ people: new Map(), vendors: new Map([[VENDOR_ID, "Acme Infra Pvt Ltd"]]) });
    render(await ContractDetailPage({ params: Promise.resolve({ id: "c1" }) }));
    expect(resolveRecordRefsMock).toHaveBeenCalledWith(expect.objectContaining({ vendors: [VENDOR_ID] }));
    expect(screen.getAllByText("Acme Infra Pvt Ltd").length).toBeGreaterThan(0);
    // The full 36-char UUID must not appear anywhere in the DOM.
    expect(screen.queryByText(VENDOR_ID)).not.toBeInTheDocument();
  });

  it("colours an approved contract with the 'good' StatusPill tone", async () => {
    getContractByIdMock.mockResolvedValue({ data: CONTRACT, source: "api", status: 200 });
    getVendorOptionsMock.mockResolvedValue({ data: [], source: "api", status: 200 });
    render(await ContractDetailPage({ params: Promise.resolve({ id: "c1" }) }));
    const pill = screen.getByText("Approved");
    expect(pill.className).toContain("good");
  });
});

describe("ContractDetailPage linked PO (GAP-PROCUREMENT-CONTRACTS-05)", () => {
  const PO_ID = "5b8e1c2a-9d3f-4e6a-8c1b-7a2d4f6e8b90";
  beforeEach(() => {
    getContractByIdMock.mockReset();
    getVendorOptionsMock.mockReset();
    getVendorOptionsMock.mockResolvedValue({ data: [], source: "api", status: 200 });
    resolveRecordRefsMock.mockReset();
    resolveRecordRefsMock.mockResolvedValue(emptyRefs());
  });

  it("links a PO uuid reference to the purchase order", async () => {
    getContractByIdMock.mockResolvedValue({ data: { ...CONTRACT, poRef: `procurement_po:${PO_ID}` }, source: "api", status: 200 });
    render(await ContractDetailPage({ params: Promise.resolve({ id: "c1" }) }));
    expect(screen.getByText("Linked PO")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View PO" })).toHaveAttribute("href", `/procurement/orders/${PO_ID}`);
  });

  it("shows free-text references as typed, without a link", async () => {
    getContractByIdMock.mockResolvedValue({ data: { ...CONTRACT, poRef: "PO/2026/0042" }, source: "api", status: 200 });
    render(await ContractDetailPage({ params: Promise.resolve({ id: "c1" }) }));
    expect(screen.getByText("PO/2026/0042")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "View PO" })).not.toBeInTheDocument();
  });

  it("omits the Linked PO field when the contract has no PO", async () => {
    getContractByIdMock.mockResolvedValue({ data: { ...CONTRACT, poRef: null }, source: "api", status: 200 });
    render(await ContractDetailPage({ params: Promise.resolve({ id: "c1" }) }));
    expect(screen.queryByText("Linked PO")).not.toBeInTheDocument();
  });
});

describe("ContractDetailPage status-aware actions (UX-R5 / DS-3)", () => {
  const MAKER = "a1a1a1a1-0000-4000-8000-000000000001";
  const CHECKER = "b2b2b2b2-0000-4000-8000-000000000002";
  beforeEach(() => {
    getContractByIdMock.mockReset();
    resolveRecordRefsMock.mockReset();
    for (const k of Object.keys(childProps)) delete childProps[k];
    resolveRecordRefsMock.mockResolvedValue({
      people: new Map([
        [MAKER, { name: "Asha Rao", designation: "Section Officer" }],
        [CHECKER, { name: "N. Gupta", designation: "DDO" }],
      ]),
      vendors: new Map([[VENDOR_ID, "Acme Infra Pvt Ltd"]]),
    });
  });

  it("a terminated contract offers no lifecycle action, no milestone/obligation change and no Raise for approval", async () => {
    getContractByIdMock.mockResolvedValue({
      data: { ...CONTRACT, status: "terminated", createdBy: MAKER, updatedBy: CHECKER, updatedAt: "2026-10-30T06:00:00Z" },
      source: "api", status: 200,
    });
    render(await ContractDetailPage({ params: Promise.resolve({ id: "c1" }) }));
    expect(screen.queryByRole("button", { name: "Lifecycle action" })).not.toBeInTheDocument();
    expect(childProps.milestones?.lockedReason).toMatch(/terminated/);
    expect(childProps.obligations?.lockedReason).toMatch(/terminated/);
    expect(childProps.bonds?.canRegister).toBe(false);
    expect(childProps.eoffice?.statusAllowsRaise).toBe(false);
    expect(screen.getByText("Terminated by N. Gupta, DDO on 30 Oct 2026.")).toBeInTheDocument();
    expect(screen.getAllByText("Asha Rao, Section Officer").length).toBeGreaterThan(0);
  });

  it("a draft contract keeps its lifecycle action and may be raised for approval", async () => {
    getContractByIdMock.mockResolvedValue({ data: { ...CONTRACT, status: "draft", createdBy: MAKER }, source: "api", status: 200 });
    render(await ContractDetailPage({ params: Promise.resolve({ id: "c1" }) }));
    expect(screen.getByRole("button", { name: "Lifecycle action" })).toBeInTheDocument();
    expect(childProps.milestones?.lockedReason).toBeNull();
    expect(childProps.eoffice?.statusAllowsRaise).toBe(true);
  });

  it("an approved contract is not raised again (awaiting nothing, already decided)", async () => {
    getContractByIdMock.mockResolvedValue({ data: { ...CONTRACT, status: "approved" }, source: "api", status: 200 });
    render(await ContractDetailPage({ params: Promise.resolve({ id: "c1" }) }));
    expect(childProps.eoffice?.statusAllowsRaise).toBe(false);
    expect(childProps.bonds?.canRegister).toBe(true);
  });
});
