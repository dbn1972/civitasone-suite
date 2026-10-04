import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as rtlRender, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const getFinanceChequeById = vi.hoisted(() => vi.fn());
const getNames = vi.hoisted(() => vi.fn());
const roles = vi.hoisted(() => ({ current: [] as string[] }));
vi.mock("@/app/_data/loaders", () => ({
  getFinanceChequeById: (...a: unknown[]) => getFinanceChequeById(...a),
  getFinanceActorNames: (...a: unknown[]) => getNames(...a),
}));
vi.mock("@/lib/auth/roleGuard", () => ({ getSessionRoles: () => roles.current }));
vi.mock("./InstrumentActions", () => ({
  InstrumentActions: (p: { canCancel: boolean; canRepresent: boolean; canStale: boolean }) => (
    <div>actions cancel={String(p.canCancel)} represent={String(p.canRepresent)} stale={String(p.canStale)}</div>
  ),
}));

import ChequeDetailPage from "./page";

function render(ui: React.ReactElement) {
  return rtlRender(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);
}
function cheque(over: Record<string, unknown>) {
  return {
    id: "i1", instrumentType: "cheque", instrumentNo: "000123", bankAccountId: null, bankName: "SBI", payee: "Acme",
    amountMinor: "150000", currency: "INR", issueDate: "2025-03-01", status: "issued",
    presentedAt: null, clearedAt: null, bouncedAt: null, cancelledAt: null, bounceReason: null, ...over,
  };
}

describe("ChequeDetailPage (GAP-FINANCE-TREASURY-CHEQUES-DETAIL-01 / -03 / -04 / -06)", () => {
  beforeEach(() => { roles.current = ["finance_officer"]; getNames.mockReset(); getNames.mockResolvedValue({}); });

  it("a bounced cheque shows the bounced icon + humanised label, offers Re-present, not Cancel", async () => {
    getFinanceChequeById.mockResolvedValue({ data: cheque({ status: "bounced", bouncedAt: "2025-03-09" }), source: "api" });
    const { container } = render(await ChequeDetailPage({ params: { id: "i1" } }));
    expect(container.querySelectorAll(".stat .ic svg")[2]?.getAttribute("class")).toMatch(/circle-x|x-circle/);
    expect(screen.getAllByText("Bounced").length).toBeGreaterThan(0);
    expect(screen.getByText("Not cleared")).toBeInTheDocument();
    expect(screen.getByText("actions cancel=false represent=true stale=false")).toBeInTheDocument();
  });

  it("a cancelled cheque shows the cancelled glyph and its reason, and offers no action", async () => {
    getFinanceChequeById.mockResolvedValue({ data: cheque({ status: "cancelled", cancelledAt: "2025-03-09", cancelReason: "Wrong payee" }), source: "api" });
    render(await ChequeDetailPage({ params: { id: "i1" } }));
    expect(screen.getByText("⛔")).toBeInTheDocument();
    expect(screen.getByText("Cancel Reason").closest(".field")).toHaveTextContent("Wrong payee");
    expect(screen.queryByText(/^actions/)).not.toBeInTheDocument();
  });

  it("a cleared cheque keeps the check icon", async () => {
    getFinanceChequeById.mockResolvedValue({ data: cheque({ status: "cleared", clearedAt: "2025-03-05T10:00:00Z" }), source: "api" });
    const { container } = render(await ChequeDetailPage({ params: { id: "i1" } }));
    expect(container.querySelectorAll(".stat .ic svg")[2]?.getAttribute("class")).toMatch(/circle-check|check-circle/);
    expect(screen.getAllByText("05 Mar 2025").length).toBeGreaterThan(0);
  });

  it("offers Cancel on an issued cheque to a finance role, and Mark stale only once it is past validUntil", async () => {
    getFinanceChequeById.mockResolvedValue({ data: cheque({ validUntil: "2999-01-01" }), source: "api" });
    const a = render(await ChequeDetailPage({ params: { id: "i1" } }));
    expect(screen.getByText("actions cancel=true represent=false stale=false")).toBeInTheDocument();
    a.unmount();
    getFinanceChequeById.mockResolvedValue({ data: cheque({ validUntil: "2020-01-01" }), source: "api" });
    render(await ChequeDetailPage({ params: { id: "i1" } }));
    expect(screen.getByText("actions cancel=true represent=false stale=true")).toBeInTheDocument();
  });

  it("hides every action from audit_officer", async () => {
    roles.current = ["audit_officer"];
    getFinanceChequeById.mockResolvedValue({ data: cheque({ validUntil: "2020-01-01" }), source: "api" });
    render(await ChequeDetailPage({ params: { id: "i1" } }));
    expect(screen.queryByText(/^actions/)).not.toBeInTheDocument();
  });

  // -01: masked account with a role-gated, audited reveal
  it("shows the account masked from the last four digits, and the full number is nowhere in the page", async () => {
    getFinanceChequeById.mockResolvedValue({ data: cheque({ bankAccountId: "b1", accountNoLast4: "6789" }), source: "api" });
    const { container } = render(await ChequeDetailPage({ params: { id: "i1" } }));
    expect(screen.getByText("Account No").closest(".field")).toHaveTextContent("XXXXXXXX6789");
    expect(container.textContent).not.toMatch(/\d{9,}/);
  });

  it("only reveal roles get the Reveal control (and only when an account is linked)", async () => {
    getFinanceChequeById.mockResolvedValue({ data: cheque({ bankAccountId: "b1", accountNoLast4: "6789" }), source: "api" });
    roles.current = ["audit_officer"];
    const a = render(await ChequeDetailPage({ params: { id: "i1" } }));
    expect(screen.queryByRole("button", { name: "Reveal" })).not.toBeInTheDocument();
    a.unmount();
    roles.current = ["finance_officer"];
    const b = render(await ChequeDetailPage({ params: { id: "i1" } }));
    expect(screen.getByRole("button", { name: "Reveal" })).toBeInTheDocument();
    b.unmount();
    getFinanceChequeById.mockResolvedValue({ data: cheque({ bankAccountId: null, accountNoLast4: null }), source: "api" });
    render(await ChequeDetailPage({ params: { id: "i1" } }));
    expect(screen.queryByRole("button", { name: "Reveal" })).not.toBeInTheDocument();
    expect(screen.getByText("Account No").closest(".field")).toHaveTextContent("—");
  });

  // -03: timeline actors
  it("names the actor on each timeline row (issued / presented / cleared) from explicit actor ids", async () => {
    getNames.mockResolvedValue({ "11111111-1111-4111-8111-111111111111": "Asha Rao", "22222222-2222-4222-8222-222222222222": "Dev Menon" });
    getFinanceChequeById.mockResolvedValue({
      data: cheque({
        status: "cleared", presentedAt: "2025-03-03T10:00:00Z", clearedAt: "2025-03-05T10:00:00Z",
        issuedBy: "11111111-1111-4111-8111-111111111111", presentedBy: "22222222-2222-4222-8222-222222222222", clearedBy: null,
      }),
      source: "api",
    });
    const { container } = render(await ChequeDetailPage({ params: { id: "i1" } }));
    const rows = within(screen.getByRole("list", { name: "Cheque clearance timeline" })).getAllByRole("listitem");
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent("Instrument issued");
    expect(rows[0]).toHaveTextContent("Asha Rao");
    expect(rows[1]).toHaveTextContent("Dev Menon");
    // no cleared-by id was supplied: a dash, never a guess
    expect(rows[2]).toHaveTextContent("Cleared by bank");
    expect(rows[2]).toHaveTextContent("—");
    expect(container.textContent).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-4/);
  });

  it("hides the actor column when no step has an actor", async () => {
    getFinanceChequeById.mockResolvedValue({ data: cheque({ status: "presented", presentedAt: "2025-03-03T10:00:00Z" }), source: "api" });
    render(await ChequeDetailPage({ params: { id: "i1" } }));
    const rows = within(screen.getByRole("list", { name: "Cheque clearance timeline" })).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    for (const r of rows) expect(r.querySelectorAll("span")).toHaveLength(2);
  });
});
