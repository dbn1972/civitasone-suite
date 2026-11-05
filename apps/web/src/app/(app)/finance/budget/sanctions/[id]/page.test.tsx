import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const getById = vi.fn();
vi.mock("../../../../../_data/loaders", () => ({ getFinanceSanctionById: (id: string) => getById(id) }));
vi.mock("../../../_components/FinanceActions", () => ({ SanctionApproveAction: () => null }));
const { raiseProps, MAKER, CHECKER, UNRESOLVED } = vi.hoisted(() => ({
  raiseProps: [] as Array<Record<string, unknown>>,
  MAKER: "11111111-2222-4000-8000-000000000001",
  CHECKER: "11111111-2222-4000-8000-000000000002",
  UNRESOLVED: "11111111-2222-4000-8000-00000000ab12",
}));
vi.mock("../../../../../_components/RaiseEOfficeNote", () => ({ RaiseEOfficeNote: (p: Record<string, unknown>) => { raiseProps.push(p); return null; } }));
vi.mock("@/lib/records/recordRefs", () => ({
  resolveRecordRefs: async () => ({
    people: new Map([
      [MAKER, { name: "Asha Rao", designation: "Section Officer" }],
      [CHECKER, { name: "N. Gupta", designation: "DDO" }],
    ]),
    vendors: new Map(),
  }),
}));
vi.mock("@/lib/auth/roleGuard", () => ({ getSessionRoles: () => ["finance_officer"] }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn() }) }));

import SanctionDetailPage from "./page";

describe("SanctionDetailPage error states (GAP-FINANCE-BUDGET-SANCTIONS-DETAIL-02)", () => {
  beforeEach(() => getById.mockReset());

  it("500 -> load error with retry, never 'not found'", async () => {
    getById.mockResolvedValue({ data: null, source: "error", status: 500 });
    render(await SanctionDetailPage({ params: Promise.resolve({ id: "x" }) }));
    expect(screen.getByText("We couldn't load the sanction because of a problem on our side.")).toBeInTheDocument();
    expect(screen.queryByText("Sanction not found")).not.toBeInTheDocument();
  });

  it("404 -> 'Sanction not found'", async () => {
    getById.mockResolvedValue({ data: null, source: "error", status: 404 });
    render(await SanctionDetailPage({ params: Promise.resolve({ id: "x" }) }));
    expect(screen.getByText("Sanction not found")).toBeInTheDocument();
  });

  it("403 -> permission copy, not 'not found'", async () => {
    getById.mockResolvedValue({ data: null, source: "error", status: 403 });
    render(await SanctionDetailPage({ params: Promise.resolve({ id: "x" }) }));
    expect(screen.queryByText("Sanction not found")).not.toBeInTheDocument();
    expect(screen.queryByText("We couldn't load the sanction because of a problem on our side.")).not.toBeInTheDocument();
  });
});

describe("SanctionDetailPage approval trail timestamps (GAP-FINANCE-BUDGET-SANCTIONS-DETAIL-06)", () => {
  beforeEach(() => getById.mockReset());
  const base = {
    id: "s1", sanctionNo: "SAN-1", subject: "Road", amount: "100000", sanctionedBy: "A", date: "2026-03-05",
    status: "approved", majorHead: "2059", remarks: null, lineItems: [],
  };

  it("a cancelled (eOffice-rejected) sanction is not treated as pending: no approval guidance", async () => {
    getById.mockResolvedValue({ data: { ...base, status: "cancelled", approvalTrail: [] }, source: "api" });
    render(await SanctionDetailPage({ params: Promise.resolve({ id: "s1" }) }));
    expect(screen.queryByText(/Approve directly|Only a finance administrator/)).not.toBeInTheDocument();
  });

  it("an ISO timestamp renders as an IST date and time, not the raw string", async () => {
    getById.mockResolvedValue({
      data: { ...base, approvalTrail: [{ actor: "B", action: "approved", timestamp: "2026-03-05T09:00:00.000Z" }] },
      source: "api",
    });
    render(await SanctionDetailPage({ params: Promise.resolve({ id: "s1" }) }));
    expect(screen.getByText(/05 Mar 2026, 02:30/i)).toBeInTheDocument();
    expect(screen.queryByText("2026-03-05T09:00:00.000Z")).not.toBeInTheDocument();
  });

  it("an invalid or missing timestamp renders a dash", async () => {
    getById.mockResolvedValue({
      data: { ...base, approvalTrail: [{ actor: "B", action: "approved", timestamp: "not-a-date" }, { actor: "C", action: "noted", timestamp: "" }] },
      source: "api",
    });
    render(await SanctionDetailPage({ params: Promise.resolve({ id: "s1" }) }));
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText("not-a-date")).not.toBeInTheDocument();
  });
});

describe("SanctionDetailPage record template (UX-R5: names not ids, status-aware actions)", () => {
  beforeEach(() => { getById.mockReset(); raiseProps.length = 0; });
  const approved = {
    id: "s1", sanctionNo: "W7-SAN-2026-0012", subject: "Laptops for the DDO office", amount: "14445763", sanctionedBy: "Unknown officer",
    sanctionedById: MAKER, date: "2026-10-28", status: "approved", majorHead: "2059", lineItems: [],
    approvalTrail: [
      { actor: "Unknown officer", actorId: MAKER, action: "created", timestamp: "2026-10-28T05:00:00.000Z" },
      { actor: "Unknown officer", actorId: CHECKER, action: "approved", timestamp: "2026-10-30T05:00:00.000Z" },
    ],
  };

  it("names the maker and checker with designation, never Unknown officer or an id", async () => {
    getById.mockResolvedValue({ data: approved, source: "api" });
    const { container } = render(await SanctionDetailPage({ params: Promise.resolve({ id: "s1" }) }));
    expect(screen.getAllByText("Asha Rao, Section Officer").length).toBeGreaterThan(0);
    expect(screen.getAllByText("N. Gupta, DDO").length).toBeGreaterThan(0);
    expect(container.textContent).not.toMatch(/Unknown officer/);
    expect(container.textContent).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/i);
  });

  it("an approved sanction shows its outcome and never offers Raise for approval", async () => {
    getById.mockResolvedValue({ data: approved, source: "api" });
    render(await SanctionDetailPage({ params: Promise.resolve({ id: "s1" }) }));
    expect(screen.getByText("Approved by N. Gupta, DDO on 30 Oct 2026.")).toBeInTheDocument();
    expect(raiseProps.at(-1)?.statusAllowsRaise).toBe(false);
    expect(screen.queryByText("Review and decide")).not.toBeInTheDocument();
  });

  it("a pending sanction keeps one primary action and allows the eOffice raise", async () => {
    getById.mockResolvedValue({ data: { ...approved, status: "pending", approvalTrail: approved.approvalTrail.slice(0, 1) }, source: "api" });
    render(await SanctionDetailPage({ params: Promise.resolve({ id: "s1" }) }));
    expect(screen.getByText("Review and decide")).toBeInTheDocument();
    expect(raiseProps.at(-1)?.statusAllowsRaise).toBe(true);
  });

  it("uses the shared DetailList (labels never glued to values) and an honest label for an unresolved id", async () => {
    getById.mockResolvedValue({ data: { ...approved, sanctionedById: UNRESOLVED }, source: "api" });
    const { container } = render(await SanctionDetailPage({ params: Promise.resolve({ id: "s1" }) }));
    expect(container.querySelector("dl[data-detail-list]")).not.toBeNull();
    expect(screen.getAllByText("Name not available (ID ending ab12)").length).toBeGreaterThan(0);
  });
});
