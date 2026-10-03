import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const getFinanceDepositById = vi.hoisted(() => vi.fn());
vi.mock("../depositDetail", async (orig) => ({ ...(await orig<typeof import("../depositDetail")>()), getFinanceDepositById: (...a: unknown[]) => getFinanceDepositById(...a) }));
import DepositDetailPage from "./page";

const deposit = { id: "d1", pdNo: "PD-1", type: "emd", administrator: "Collector", balanceMinor: "5000", currency: "INR", status: "active", refundedMinor: "1000", forfeitedMinor: "0", adjustedMinor: "0", createdAt: "2026-09-01T00:00:00Z",
  events: [{ id: "e1", eventType: "refund", amountMinor: "1000", reference: "REF-1", journalId: "j1", createdAt: "2026-09-02T00:00:00Z" }] };

describe("DepositDetailPage (GAP-FINANCE-TREASURY-DEPOSITS-03)", () => {
  it("shows the balances and the ledger, with a voucher link where the event has a journal", async () => {
    getFinanceDepositById.mockResolvedValue({ data: deposit, source: "api" });
    render(await DepositDetailPage({ params: { id: "d1" } }));
    expect(screen.getByText("Deposit PD-1")).toBeInTheDocument();
    expect(screen.getByText("REF-1")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open voucher" }).getAttribute("href")).toBe("/api/proxy/v1/finance/journals/j1/pdf");
  });
  it("an empty ledger is its own empty state", async () => {
    getFinanceDepositById.mockResolvedValue({ data: { ...deposit, events: [] }, source: "api" });
    render(await DepositDetailPage({ params: { id: "d1" } }));
    expect(screen.getByText("No ledger events")).toBeInTheDocument();
  });
  it("a real 404 is 'not found'; any other failure is a retryable error, never 'not found'", async () => {
    getFinanceDepositById.mockResolvedValue({ data: null, source: "error", status: 404 });
    const { unmount } = render(await DepositDetailPage({ params: { id: "x" } }));
    expect(screen.getByText("Deposit not found")).toBeInTheDocument();
    unmount();
    getFinanceDepositById.mockResolvedValue({ data: null, source: "error", status: 503 });
    render(await DepositDetailPage({ params: { id: "x" } }));
    expect(screen.queryByText("Deposit not found")).not.toBeInTheDocument();
  });
});
