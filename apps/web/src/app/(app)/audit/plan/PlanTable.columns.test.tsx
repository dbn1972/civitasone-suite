import { describe, it, expect, vi } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import type { AuditPlanItem } from "@civitasone/types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
}));

import { PlanTable } from "./PlanTable";

// GAP-AUDIT-PLAN-01 / PLAN-03: the planner-entered plan number, title and the
// chosen risk level must reach the table. Risk must read the parent plan's
// riskLevel, NOT a value derived from the audit `type`.
describe("PlanTable columns (GAP-AUDIT-PLAN-01 / PLAN-03)", () => {
  const base: AuditPlanItem = {
    id: "11111111-1111-1111-1111-111111111111",
    auditUnit: "Procurement Wing",
    department: "Finance",
    type: "routine",
    plannedFrom: "2026-10-01",
    plannedTo: "2026-10-12",
    status: "planned",
  };

  it("shows the Plan no. and Title entered by the planner", () => {
    render(
      <PlanTable
        items={[{ ...base, planNo: "PLAN-FY26-03", title: "Procurement compliance audit", riskLevel: "high" }]}
      />,
    );
    expect(screen.getByText("PLAN-FY26-03")).toBeInTheDocument();
    expect(screen.getByText("Procurement compliance audit")).toBeInTheDocument();
    // Area is kept as secondary text under the title.
    expect(screen.getByText(/Procurement Wing · Finance/)).toBeInTheDocument();
  });

  it("renders Risk from riskLevel (High) even for a routine audit — old code derived Low from type", () => {
    render(
      <PlanTable
        items={[{ ...base, planNo: "PLAN-FY26-03", title: "Routine but high-risk", riskLevel: "high" }]}
      />,
    );
    const table = screen.getByRole("table");
    // The old type-derived mapping would have shown "Low" for a routine audit.
    expect(within(table).getByText("High")).toBeInTheDocument();
    expect(within(table).queryByText("Low")).not.toBeInTheDocument();
  });

  it("falls back to '—' when a row has no parent-plan risk level", () => {
    render(<PlanTable items={[{ ...base, planNo: "PLAN-FY26-07", title: "No risk level" }]} />);
    const table = screen.getByRole("table");
    // Risk cell shows the em dash; no fabricated band.
    expect(within(table).getAllByText("—").length).toBeGreaterThan(0);
    expect(within(table).queryByText("High")).not.toBeInTheDocument();
    expect(within(table).queryByText("Medium")).not.toBeInTheDocument();
    expect(within(table).queryByText("Low")).not.toBeInTheDocument();
  });
});

describe("PlanTable same-unit engagements (GAP-AUDIT-PLAN-03)", () => {
  const unit = { auditUnit: "Procurement Wing", department: "Finance", type: "routine", plannedFrom: "2026-10-01", plannedTo: "2026-10-12", status: "planned" } as const;

  it("two plans in one unit show distinct plan no. and title, and the filter box matches plan no.", () => {
    render(
      <PlanTable
        items={[
          { ...unit, id: "a", planNo: "PLAN-FY26-01", title: "Tender audit" },
          { ...unit, id: "b", planNo: "PLAN-FY26-02", title: "Stores audit" },
        ]}
      />,
    );
    expect(screen.getByText("PLAN-FY26-01")).toBeInTheDocument();
    expect(screen.getByText("PLAN-FY26-02")).toBeInTheDocument();
    expect(screen.getByText("Tender audit")).toBeInTheDocument();
    expect(screen.getByText("Stores audit")).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText(/Filter by plan no/), { target: { value: "FY26-02" } });
    expect(screen.queryByText("PLAN-FY26-01")).not.toBeInTheDocument();
    expect(screen.getByText("PLAN-FY26-02")).toBeInTheDocument();
  });
});
