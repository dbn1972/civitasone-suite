import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const getFinanceChequeById = vi.hoisted(() => vi.fn());
const roles = vi.hoisted(() => ({ current: [] as string[] }));
vi.mock("@/app/_data/loaders", () => ({ getFinanceChequeById: (...a: unknown[]) => getFinanceChequeById(...a) }));
vi.mock("@/lib/auth/roleGuard", () => ({ getSessionRoles: () => roles.current }));
vi.mock("./InstrumentActions", () => ({ InstrumentActions: () => <button type="button">cancel-action</button> }));

import ChequeDetailPage from "./page";

function cheque(over: Record<string, unknown>) {
  return {
    id: "i1", instrumentType: "cheque", instrumentNo: "000123", bankAccountId: null, bankName: "SBI", payee: "Acme",
    amountMinor: "150000", currency: "INR", issueDate: "2025-03-01", status: "issued",
    presentedAt: null, clearedAt: null, bouncedAt: null, cancelledAt: null, bounceReason: null, ...over,
  };
}

describe("ChequeDetailPage (GAP-FINANCE-TREASURY-CHEQUES-DETAIL-04 / -06)", () => {
  beforeEach(() => { roles.current = ["finance_officer"]; });

  it("a bounced cheque shows the bounced icon + humanised label and no Cancel", async () => {
    getFinanceChequeById.mockResolvedValue({ data: cheque({ status: "bounced", bouncedAt: "2025-03-09" }), source: "api" });
    const { container } = render(await ChequeDetailPage({ params: { id: "i1" } }));
    // StatIcon renders mapped glyphs as lucide SVGs: the bounced card uses the X-circle icon.
    expect(container.querySelectorAll(".stat .ic svg")[2]?.getAttribute("class")).toMatch(/circle-x|x-circle/);
    expect(screen.getAllByText("Bounced").length).toBeGreaterThan(0);
    expect(screen.getByText("Not cleared")).toBeInTheDocument();
    expect(screen.queryByText("cancel-action")).not.toBeInTheDocument();
  });

  it("a cancelled cheque shows the cancelled glyph", async () => {
    getFinanceChequeById.mockResolvedValue({ data: cheque({ status: "cancelled", cancelledAt: "2025-03-09" }), source: "api" });
    render(await ChequeDetailPage({ params: { id: "i1" } }));
    expect(screen.getByText("⛔")).toBeInTheDocument();
  });

  it("a cleared cheque keeps the check icon", async () => {
    getFinanceChequeById.mockResolvedValue({ data: cheque({ status: "cleared", clearedAt: "2025-03-05T10:00:00Z" }), source: "api" });
    const { container } = render(await ChequeDetailPage({ params: { id: "i1" } }));
    expect(container.querySelectorAll(".stat .ic svg")[2]?.getAttribute("class")).toMatch(/circle-check|check-circle/);
    expect(screen.getAllByText("05 Mar 2025").length).toBeGreaterThan(0);
  });

  it("offers Cancel on an issued cheque to a finance role", async () => {
    getFinanceChequeById.mockResolvedValue({ data: cheque({}), source: "api" });
    render(await ChequeDetailPage({ params: { id: "i1" } }));
    expect(screen.getByText("cancel-action")).toBeInTheDocument();
  });

  it("hides Cancel from audit_officer", async () => {
    roles.current = ["audit_officer"];
    getFinanceChequeById.mockResolvedValue({ data: cheque({}), source: "api" });
    render(await ChequeDetailPage({ params: { id: "i1" } }));
    expect(screen.queryByText("cancel-action")).not.toBeInTheDocument();
  });
});
