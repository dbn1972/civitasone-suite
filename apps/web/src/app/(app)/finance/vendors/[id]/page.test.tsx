import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as rtlRender, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

// RevealableValue (client) uses next-intl.
function render(ui: React.ReactElement) {
  return rtlRender(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);
}

const getFinanceVendorById = vi.hoisted(() => vi.fn());
const getFinanceActorNames = vi.hoisted(() => vi.fn());
const session = vi.hoisted(() => ({ roles: [] as string[], userId: "me-0000" as string | null }));
vi.mock("@/app/_data/loaders", () => ({
  getFinanceVendorById: (...a: unknown[]) => getFinanceVendorById(...a),
  getFinanceActorNames: (...a: unknown[]) => getFinanceActorNames(...a),
}));
vi.mock("@/lib/auth/roleGuard", () => ({ getSessionRoles: () => session.roles, getSessionUserId: () => session.userId }));
vi.mock("../VendorStatusAction", () => ({ VendorStatusAction: () => <div>status-action</div> }));
vi.mock("../VendorApprovalActions", () => ({
  VendorApprovalActions: (p: { createdByMe: boolean }) => <div>approval-actions {p.createdByMe ? "own" : "other"}</div>,
}));
vi.mock("../VendorBankChange", () => ({
  VendorBankChange: (p: { pending: { proposedByName: string; proposedByMe: boolean } | null; canPropose: boolean; canDecide: boolean }) => (
    <div>bank-change {p.pending ? `pending:${p.pending.proposedByName}:${p.pending.proposedByMe}` : "none"} propose={String(p.canPropose)} decide={String(p.canDecide)}</div>
  ),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import VendorDetailPage from "./page";

const base = { id: "v1", name: "Acme", category: "Goods", status: "active", version: 1 };

describe("VendorDetailPage (GAP-FINANCE-VENDORS-DETAIL-03 / -05 / -06 / -07)", () => {
  beforeEach(() => {
    getFinanceVendorById.mockReset();
    getFinanceActorNames.mockReset();
    getFinanceActorNames.mockResolvedValue({});
    session.roles = [];
    session.userId = "me-0000";
  });

  it("Total Paid counts paid bills only, Total Billed all of them", async () => {
    getFinanceVendorById.mockResolvedValue({
      data: {
        ...base,
        bills: [
          { id: "b1", billNo: "B-1", date: "2025-03-01", amount: "1000", tds: "100", status: "paid" },
          { id: "b2", billNo: "B-2", date: "2025-03-02", amount: "500", tds: "50", status: "pending" },
          { id: "b3", billNo: "B-3", date: "2025-03-03", amount: "200", tds: "0", status: "rejected" },
        ],
      },
      source: "api",
    });
    render(await VendorDetailPage({ params: { id: "v1" } }));
    expect(screen.getByText("Total Paid (initiated)").closest(".stat")).toHaveTextContent("₹10.00");
    expect(screen.getByText("Total Billed").closest(".stat")).toHaveTextContent("₹17.00");
    expect(screen.getByText("TDS Deducted (initiated payments)").closest(".stat")).toHaveTextContent("₹1.00");
  });

  it("shows an em dash, not the pending sum, when no bill is paid", async () => {
    getFinanceVendorById.mockResolvedValue({
      data: { ...base, bills: [{ id: "b2", billNo: "B-2", date: "2025-03-02", amount: "500", tds: "50", status: "pending" }] },
      source: "api",
    });
    render(await VendorDetailPage({ params: { id: "v1" } }));
    expect(screen.getByText("Total Paid (initiated)").closest(".stat")).toHaveTextContent("—");
    expect(screen.getByText("Total Paid (initiated)").closest(".stat")).not.toHaveTextContent("₹5.00");
  });

  it("sums exactly above 2^53 paise", async () => {
    getFinanceVendorById.mockResolvedValue({
      data: {
        ...base,
        bills: [
          { id: "b1", billNo: "B-1", date: "2025-03-01", amount: "9007199254740993", tds: "0", status: "paid" },
          { id: "b2", billNo: "B-2", date: "2025-03-01", amount: "1", tds: "0", status: "paid" },
        ],
      },
      source: "api",
    });
    render(await VendorDetailPage({ params: { id: "v1" } }));
    expect(screen.getByText("Total Paid (initiated)").closest(".stat")).toHaveTextContent("₹9,00,71,99,25,47,409.94");
  });

  it("prints a single dash for a vendor with no bank data, and a formatted date", async () => {
    getFinanceVendorById.mockResolvedValue({ data: { ...base, createdAt: "2024-03-05T10:00:00Z", bills: [] }, source: "api" });
    render(await VendorDetailPage({ params: { id: "v1" } }));
    expect(screen.queryByText("— (—)")).not.toBeInTheDocument();
    expect(screen.getByText("05 Mar 2024")).toBeInTheDocument();
  });

  it("links a bill row to the expenditure bill detail", async () => {
    getFinanceVendorById.mockResolvedValue({
      data: { ...base, bills: [{ id: "b1", billNo: "B-1", date: "2025-03-01", amount: "1000", tds: "0", status: "paid" }] },
      source: "api",
    });
    render(await VendorDetailPage({ params: { id: "v1" } }));
    expect(screen.getByRole("link", { name: /Open/i })).toHaveAttribute("href", "/finance/expenditure/bills/b1");
  });

  // fp-finance-02: approval workflow, bank change and audited reveal.
  const PENDING_VENDOR = { ...base, status: "pending", createdBy: "11111111-1111-4111-8111-111111111111", pan: "ABCDE****F", phone: "******3210", email: "a***@x.in", bankAccount: "********9012", bills: [] };

  it("a pending vendor shows Approve / Reject to an approver (flagging the creator) and no activate/deactivate or bank change", async () => {
    session.roles = ["finance_admin"];
    session.userId = "11111111-1111-4111-8111-111111111111";
    getFinanceVendorById.mockResolvedValue({ data: PENDING_VENDOR, source: "api" });
    render(await VendorDetailPage({ params: { id: "v1" } }));
    expect(screen.getByText("approval-actions own")).toBeInTheDocument();
    expect(screen.queryByText("status-action")).not.toBeInTheDocument();
    expect(screen.queryByText(/^bank-change/)).not.toBeInTheDocument();
  });

  it("a pending vendor offers nothing to a non-approver", async () => {
    session.roles = ["finance_officer"];
    getFinanceVendorById.mockResolvedValue({ data: PENDING_VENDOR, source: "api" });
    render(await VendorDetailPage({ params: { id: "v1" } }));
    expect(screen.queryByText(/approval-actions/)).not.toBeInTheDocument();
  });

  it("an active vendor shows who created / approved it by NAME and the pending bank change with its proposer", async () => {
    session.roles = ["finance_admin"];
    getFinanceActorNames.mockResolvedValue({
      "11111111-1111-4111-8111-111111111111": "Asha Rao", "22222222-2222-4222-8222-222222222222": "Dev Menon", "33333333-3333-4333-8333-333333333333": "Kiran Shah",
    });
    getFinanceVendorById.mockResolvedValue({
      data: {
        ...base, createdBy: "11111111-1111-4111-8111-111111111111", approvedBy: "22222222-2222-4222-8222-222222222222", approvedAt: "2026-07-01T10:00:00Z",
        pendingBankChange: { id: "c1", proposedBy: "33333333-3333-4333-8333-333333333333", proposedAt: "2026-07-02T10:00:00Z", bankName: "SBI", ifsc: "SBINXXXXXXX", accountMasked: "********5544", reason: "Moved banks" },
        bills: [],
      },
      source: "api",
    });
    const { container } = render(await VendorDetailPage({ params: { id: "v1" } }));
    expect(screen.getByText("Created by").closest(".field")).toHaveTextContent("Asha Rao");
    expect(screen.getByText("Approved by").closest(".field")).toHaveTextContent("Dev Menon");
    expect(screen.getByText(/bank-change pending:Kiran Shah:false propose=true decide=true/)).toBeInTheDocument();
    expect(screen.getByText("status-action")).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-4/);
  });

  it("only reveal roles get Reveal controls; the page never holds a clear value", async () => {
    getFinanceVendorById.mockResolvedValue({ data: PENDING_VENDOR, source: "api" });
    session.roles = ["audit_officer"];
    const a = render(await VendorDetailPage({ params: { id: "v1" } }));
    expect(screen.queryByRole("button", { name: "Reveal" })).not.toBeInTheDocument();
    expect(a.container.textContent).toContain("ABCDE****F");
    expect(a.container.textContent).toContain("******3210");
    a.unmount();
    session.roles = ["finance_officer"];
    render(await VendorDetailPage({ params: { id: "v1" } }));
    expect(screen.getAllByRole("button", { name: "Reveal" })).toHaveLength(4);
  });
});
