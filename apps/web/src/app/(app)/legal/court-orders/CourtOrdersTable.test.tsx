import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactElement } from "react";

vi.mock("@/lib/sync/resource", () => ({ useSeededResource: vi.fn() }));
vi.mock("../../../_components/DataSourceBadge", () => ({ DataSourceBadge: () => null }));

import { useSeededResource } from "@/lib/sync/resource";
import { CourtOrdersTable, isOverdue } from "./CourtOrdersTable";
import type { CourtOrderSummary } from "@civitasone/types";

const mockedHook = vi.mocked(useSeededResource);

function seed(data: CourtOrderSummary[]) {
  mockedHook.mockReturnValue({
    data,
    provenance: "live",
    offline: false,
    cachedAt: null,
    fromCache: false,
  } as unknown as ReturnType<typeof useSeededResource>);
}

function renderTable(ui: ReactElement) {
  return render(ui);
}

const base: CourtOrderSummary = {
  id: "o1",
  caseId: "c1",
  caseNo: "WP/1/2024",
  court: "High Court",
  orderDate: "2026-01-01",
  summary: "Do the thing",
  complianceRequired: false,
  status: "pending",
};

describe("CourtOrdersTable Type column (GAP-LEGAL-COURT-ORDERS-01)", () => {
  beforeEach(() => mockedHook.mockReset());

  it("shows the recorded order type (Judgment), not a complianceRequired-derived 'Stay'", () => {
    seed([{ ...base, orderType: "judgment", complianceRequired: false }]);
    renderTable(<CourtOrdersTable items={[]} today="2026-02-01" />);
    expect(screen.getByText("Judgment")).toBeInTheDocument();
    expect(screen.queryByText("Stay")).not.toBeInTheDocument();
  });

  it("shows a real stay as Stay", () => {
    seed([{ ...base, orderType: "stay", complianceRequired: false }]);
    renderTable(<CourtOrdersTable items={[]} today="2026-02-01" />);
    expect(screen.getByText("Stay")).toBeInTheDocument();
  });
});

describe("CourtOrdersTable status labels (GAP-LEGAL-COURT-ORDERS-02)", () => {
  beforeEach(() => mockedHook.mockReset());

  it("labels an appealed order 'Under appeal', never 'Under compliance'", () => {
    seed([{ ...base, orderType: "order", status: "appealed" }]);
    renderTable(<CourtOrdersTable items={[]} today="2026-02-01" />);
    expect(screen.getByText("Under appeal")).toBeInTheDocument();
    expect(screen.queryByText("Under compliance")).not.toBeInTheDocument();
  });
});

describe("CourtOrdersTable overdue semantics (GAP-LEGAL-COURT-ORDERS-03)", () => {
  beforeEach(() => mockedHook.mockReset());

  it("isOverdue is false when the deadline is today (IST), true only when strictly before", () => {
    const dueToday: CourtOrderSummary = { ...base, complianceRequired: true, status: "pending", complianceDeadline: "2026-02-01" };
    const dueYesterday: CourtOrderSummary = { ...dueToday, complianceDeadline: "2026-01-31" };
    expect(isOverdue(dueToday, "2026-02-01")).toBe(false);
    expect(isOverdue(dueYesterday, "2026-02-01")).toBe(true);
  });

  it("renders 'Due today' for a deadline that is today, and 'Overdue' only when past", () => {
    seed([{ ...base, orderType: "direction", complianceRequired: true, status: "pending", complianceDeadline: "2026-02-01" }]);
    renderTable(<CourtOrdersTable items={[]} today="2026-02-01" />);
    expect(screen.getByText("Due today")).toBeInTheDocument();
    expect(screen.queryByText("Overdue")).not.toBeInTheDocument();
  });
});
