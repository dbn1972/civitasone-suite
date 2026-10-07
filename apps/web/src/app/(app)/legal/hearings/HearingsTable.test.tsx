import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
const resourceMock = vi.fn();
vi.mock("@/lib/sync/resource", () => ({ useSeededResource: (...a: unknown[]) => resourceMock(...a) }));
vi.mock("@/lib/useFormError", () => ({ useFormError: () => ({ fromResponse: vi.fn(), fromException: () => ({ message: "err" }) }) }));

import { HearingsTable } from "./HearingsTable";

type Row = Record<string, unknown>;
const row = (over: Row = {}): Row => ({
  id: "h-1",
  caseId: "case-1",
  caseNo: "WP-2026-1",
  caseTitle: "State v. X",
  court: "High Court",
  date: "2026-10-10",
  status: "scheduled",
  ...over,
});
function mockRows(rows: Row[]) {
  resourceMock.mockReturnValue({ data: rows, provenance: "live", offline: false, cachedAt: null, fromCache: false });
}

const TODAY = "2026-10-06";

describe("HearingsTable status pills (GAP-LEGAL-HEARINGS-01)", () => {
  beforeEach(() => resourceMock.mockReset());

  it("completed renders 'Heard', scheduled renders 'Listed', unknown humanizes", () => {
    mockRows([
      row({ id: "a", caseNo: "A", status: "completed", date: "2026-10-01", outcome: "Dismissed" }),
      row({ id: "b", caseNo: "B", status: "scheduled", date: "2026-10-10" }),
      row({ id: "c", caseNo: "C", status: "foo", date: "2026-10-10" }),
    ]);
    render(<HearingsTable items={[]} source="api" today={TODAY} />);
    // show all so completed/past rows are visible too
    fireEvent.click(screen.getByRole("tab", { name: "All" }));
    expect(screen.getByText("Heard")).toBeInTheDocument();
    expect(screen.getAllByText("Listed").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Foo")).toBeInTheDocument();
    // a heard hearing is NOT labelled a green "Listed" anymore
    expect(screen.queryByText("foo")).not.toBeInTheDocument();
  });
});

describe("HearingsTable filters (GAP-LEGAL-HEARINGS-02)", () => {
  beforeEach(() => resourceMock.mockReset());

  const rows = [
    row({ id: "past", caseNo: "PAST", status: "completed", date: "2026-10-01", outcome: "Allowed" }),
    row({ id: "today", caseNo: "TODAY", status: "scheduled", date: TODAY }),
    row({ id: "fut", caseNo: "FUTURE", status: "scheduled", date: "2026-10-20" }),
  ];

  it("Past shows only hearings before today, with their outcome", () => {
    mockRows(rows);
    render(<HearingsTable items={[]} source="api" today={TODAY} />);
    fireEvent.click(screen.getByRole("tab", { name: "Past" }));
    expect(screen.getByText("PAST")).toBeInTheDocument();
    expect(screen.getByText("Allowed")).toBeInTheDocument();
    expect(screen.queryByText("FUTURE")).not.toBeInTheDocument();
    expect(screen.queryByText("TODAY")).not.toBeInTheDocument();
  });

  it("All shows every row including completed", () => {
    mockRows(rows);
    render(<HearingsTable items={[]} source="api" today={TODAY} />);
    fireEvent.click(screen.getByRole("tab", { name: "All" }));
    expect(screen.getByText("PAST")).toBeInTheDocument();
    expect(screen.getByText("TODAY")).toBeInTheDocument();
    expect(screen.getByText("FUTURE")).toBeInTheDocument();
  });

  it("Today filter uses the IST today prop", () => {
    mockRows(rows);
    render(<HearingsTable items={[]} source="api" today={TODAY} />);
    fireEvent.click(screen.getByRole("tab", { name: "Today" }));
    expect(screen.getByText("TODAY")).toBeInTheDocument();
    expect(screen.queryByText("PAST")).not.toBeInTheDocument();
    expect(screen.queryByText("FUTURE")).not.toBeInTheDocument();
  });
});
