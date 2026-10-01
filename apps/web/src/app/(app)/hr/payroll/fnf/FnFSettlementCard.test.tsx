import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import enMessages from "@/messages/en.json";
import { FnFSettlementCards, settlementFoots, type FnFCardRow } from "./FnFSettlementCard";

const base: FnFCardRow = {
  id: "s1", employeeId: "e1", employeeName: "Meera Iyer", employeeCode: "EMP-1",
  separationType: "retirement", separationDate: "2026-07-01", status: "draft",
  noticeBuyoutMinor: "0", leaveEncashmentGrossMinor: "1000000", gratuityGrossMinor: "0",
  retrenchmentCompMinor: "0", vrsCompMinor: "0", arrearsMinor: "50000",
  tdsOnSeparationMinor: "20000", netPayableMinor: "1030000",
  gratuityExemptMinor: "0", leaveEncashExemptMinor: "1000000",
};

function renderCards(rows: FnFCardRow[]) {
  render(<NextIntlClientProvider locale="en" messages={enMessages}><FnFSettlementCards rows={rows} /></NextIntlClientProvider>);
}

describe("FnFSettlementCards (GAP-PAYROLL-FNF-06)", () => {
  it("shows every component row, including a zero gratuity as ₹0.00, and TDS as the deduction", () => {
    renderCards([base]);
    fireEvent.click(screen.getByRole("button", { name: /show breakdown/i }));
    const table = screen.getByRole("table");
    expect(within(table).getByRole("rowheader", { name: "Gratuity" }).closest("tr")).toHaveTextContent("₹0.00");
    expect(within(table).getByRole("rowheader", { name: "Leave Encashment" }).closest("tr")).toHaveTextContent("₹10,000.00");
    expect(within(table).getByRole("rowheader", { name: "Arrears" }).closest("tr")).toHaveTextContent("₹500.00");
    expect(within(table).getByRole("rowheader", { name: "TDS on Separation" }).closest("tr")).toHaveTextContent("−₹200.00");
    expect(within(table).queryByText("Deductions")).not.toBeInTheDocument();
    expect(screen.queryByText(/do not add up/)).not.toBeInTheDocument();
  });

  it("renders a very large net payable exactly (no float rounding)", () => {
    renderCards([{ ...base, netPayableMinor: "123456789012" }]);
    expect(screen.getByText("₹1,23,45,67,890.12")).toBeInTheDocument();
  });

  it("flags a breakdown that does not foot to the net payable", () => {
    renderCards([{ ...base, netPayableMinor: "999" }]);
    fireEvent.click(screen.getByRole("button", { name: /show breakdown/i }));
    expect(screen.getByText(/do not add up to the net payable/)).toBeInTheDocument();
  });

  it("settlementFoots: gross components minus TDS equals net", () => {
    expect(settlementFoots(base)).toBe(true);
    expect(settlementFoots({ ...base, netPayableMinor: "1030001" })).toBe(false);
  });

  it("no Intl.NumberFormat / local rupee helper remains in fnf/", () => {
    const dir = __dirname;
    for (const f of readdirSync(dir).filter((n) => n.endsWith(".tsx") && !n.endsWith(".test.tsx"))) {
      expect(readFileSync(join(dir, f), "utf8"), f).not.toMatch(/Intl\.NumberFormat/);
    }
  });
});
