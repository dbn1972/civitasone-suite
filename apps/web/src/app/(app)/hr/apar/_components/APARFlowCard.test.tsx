import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import { todayIST } from "@/lib/formatters";
import { APARFlowList, type AparRecord } from "./APARFlowCard";

function shift(days: number): string {
  const d = new Date(`${todayIST()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function rec(over: Partial<AparRecord> = {}): AparRecord {
  return { id: "a1", employeeName: "Asha Verma", employeeNo: "E1", appraisalPeriod: "2025-26", status: "reporting_officer", updatedAt: "2026-04-01T00:00:00Z", ...over };
}

function renderList(records: AparRecord[]) {
  return render(<NextIntlClientProvider locale="en" messages={enMessages}><APARFlowList records={records} /></NextIntlClientProvider>);
}

describe("APARFlowCard deadline (GAP-HR-APAR-03)", () => {
  it("shows 'Due in 5 days' with text, for a future deadline", () => {
    renderList([rec({ deadline: shift(5) })]);
    expect(screen.getByTestId("apar-deadline")).toHaveTextContent("Due in 5 days");
  });
  it("shows 'Overdue by 2 days' for a past deadline (text, not colour alone)", () => {
    renderList([rec({ deadline: shift(-2) })]);
    expect(screen.getByTestId("apar-deadline")).toHaveTextContent("Overdue by 2 days");
  });
  it("shows 'Due today'", () => {
    renderList([rec({ deadline: shift(0) })]);
    expect(screen.getByTestId("apar-deadline")).toHaveTextContent("Due today");
  });
  it("shows nothing when there is no deadline, or the record is finalised", () => {
    renderList([rec({ deadline: null }), rec({ id: "a2", status: "finalised", deadline: shift(-9) })]);
    expect(screen.queryByTestId("apar-deadline")).toBeNull();
  });
});
