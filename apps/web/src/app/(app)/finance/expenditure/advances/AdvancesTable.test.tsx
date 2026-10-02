import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), usePathname: () => "/", useSearchParams: () => new URLSearchParams() }));

import { AdvancesTable } from "./AdvancesTable";

const adv = (id: string, type: "employee" | "vendor" | "other", extra: Record<string, unknown> = {}) => ({
  id, advanceNo: `ADV-${id}`, beneficiary: `Payee ${id}`, type, amount: "100000", disbursedDate: "2026-04-01",
  adjustedAmount: "0", balance: "100000", status: "active" as const, ...extra,
});

function renderTable(rows: ReturnType<typeof adv>[]) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <AdvancesTable advances={rows} />
    </NextIntlClientProvider>,
  );
}

describe("AdvancesTable", () => {
  // GAP-FINANCE-EXPENDITURE-ADVANCES-03
  it("separates officer advances from party advances with a kind filter", () => {
    renderTable([adv("1", "employee"), adv("2", "vendor"), adv("3", "other")]);
    fireEvent.click(screen.getByRole("tab", { name: "Officers" }));
    expect(screen.getByText("ADV-1")).toBeInTheDocument();
    expect(screen.queryByText("ADV-2")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Parties" }));
    expect(screen.queryByText("ADV-1")).not.toBeInTheDocument();
    expect(screen.getByText("ADV-2")).toBeInTheDocument();
    expect(screen.getByText("ADV-3")).toBeInTheDocument();
  });

  it("the kind filter composes with the status tabs", () => {
    renderTable([adv("1", "employee"), adv("2", "employee", { status: "overdue" }), adv("3", "vendor", { status: "overdue" })]);
    fireEvent.click(screen.getByRole("tab", { name: "Officers" }));
    fireEvent.click(screen.getByRole("tab", { name: "Overdue" }));
    expect(screen.getByText("ADV-2")).toBeInTheDocument();
    expect(screen.queryByText("ADV-1")).not.toBeInTheDocument();
    expect(screen.queryByText("ADV-3")).not.toBeInTheDocument();
  });

  // GAP-FINANCE-EXPENDITURE-ADVANCES-NEW-06 / -06: Type and Purpose are separate columns, the payee column says "Payee".
  it("shows Payee / Type / Purpose as distinct columns with the entered wording", () => {
    renderTable([adv("1", "vendor", { purpose: "Site mobilisation" })]);
    expect(screen.getByRole("columnheader", { name: /^Payee/ })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /^Type/ })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /^Purpose/ })).toBeInTheDocument();
    expect(screen.getByText("Vendor")).toBeInTheDocument();
    expect(screen.getByText("Site mobilisation")).toBeInTheDocument();
  });

  // GAP-FINANCE-EXPENDITURE-ADVANCES-05
  it("offers a CSV export", () => {
    renderTable([adv("1", "employee")]);
    expect(screen.getByRole("button", { name: /export|csv/i })).toBeInTheDocument();
  });
});
