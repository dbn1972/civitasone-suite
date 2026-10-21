import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import { formatMoney } from "@/lib/formatters";

import { TravelRequestsTable, claimExpensesHref } from "./TravelRequestsTable";
import type { Row } from "./mapTravel";

function row(over: Partial<Row>): Row {
  return {
    id: "11111111-2222-4333-8444-555555555555", destination: "Pune", purpose: "Field inspection",
    from_date: "2026-10-01", to_date: "2026-10-03", mode: "rail", status: "pending",
    advanceRequired: null, rejectionReason: "—", canClaim: false, ...over,
  };
}

function renderTable(rows: Row[], isApprover = false) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <TravelRequestsTable rows={rows} isApprover={isApprover} />
    </NextIntlClientProvider>,
  );
}

describe("TravelRequestsTable advance column (GAP-HR-TRAVEL-02 / -05)", () => {
  it("an advance of 250000 paise renders as formatted INR through formatMoney", () => {
    renderTable([row({ advanceRequired: 250000 })]);
    const shown = formatMoney(250000);
    expect(shown).toMatch(/2,500\.00/);
    const tr = screen.getByText("Pune").closest("tr") as HTMLElement;
    expect(within(tr).getByText(shown!)).toBeInTheDocument();
  });

  it("no advance requested renders a dash, not ₹0.00", () => {
    renderTable([row({ advanceRequired: null })]);
    const tr = screen.getByText("Pune").closest("tr") as HTMLElement;
    expect(tr.textContent).not.toMatch(/0\.00/);
  });

  it("the table has an Advance column", () => {
    renderTable([row({})]);
    expect(screen.getByRole("columnheader", { name: /advance/i })).toBeInTheDocument();
  });
});

describe("TravelRequestsTable claim link (GAP-HR-TRAVEL-02)", () => {
  it("an approved request links to the expense claim form pre-linked to that trip", () => {
    renderTable([row({ status: "approved", canClaim: true })]);
    const link = screen.getByRole("link", { name: /claim expenses for travel to pune/i });
    expect(link).toHaveAttribute("href", "/hr/expenses?travelRequestId=11111111-2222-4333-8444-555555555555");
    expect(link).toHaveTextContent("Claim expenses");
  });

  it("a pending, rejected or cancelled request has no claim link", () => {
    renderTable([
      row({ id: "a", destination: "Pending Town", status: "pending" }),
      row({ id: "b", destination: "Rejected City", status: "rejected" }),
      row({ id: "c", destination: "Cancelled Ville", status: "cancelled" }),
    ]);
    expect(screen.queryByRole("link", { name: /claim expenses/i })).toBeNull();
  });

  it("claimExpensesHref encodes the id for the query string", () => {
    expect(claimExpensesHref("a b&c")).toBe("/hr/expenses?travelRequestId=a%20b%26c");
  });
});

describe("TravelRequestsTable rejection reason (GAP-HR-TRAVEL-01)", () => {
  it("the requester sees why a request was rejected", () => {
    renderTable([row({ status: "rejected", rejectionReason: "Budget exceeded" })]);
    expect(screen.getByRole("columnheader", { name: /rejection reason/i })).toBeInTheDocument();
    expect(screen.getByText("Budget exceeded")).toBeInTheDocument();
  });
});

describe("TravelRequestsTable empty state per role (GAP-HR-TRAVEL-01)", () => {
  it("an employee is told their reporting manager reviews requests", () => {
    renderTable([], false);
    expect(screen.getByText(/reporting manager reviews each request/i)).toBeInTheDocument();
  });

  it("an approver is pointed at Pending Approvals instead, with no 'reporting manager' promise about their own requests", () => {
    renderTable([], true);
    expect(screen.getByText(/listed under Pending Approvals/i)).toBeInTheDocument();
    expect(screen.queryByText(/reporting manager reviews each request/i)).toBeNull();
  });
});
