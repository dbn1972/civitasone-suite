import { describe, it, expect, vi } from "vitest";
import { render as rtlRender, screen } from "@testing-library/react";
import { NextIntlClientProvider as __Intl } from "next-intl";
import __enMessages from "@/messages/en.json";
function render(ui: React.ReactElement) {
  return rtlRender(<__Intl locale="en" messages={__enMessages}>{ui}</__Intl>);
}

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { ActivitiesTable } from "./ActivitiesTable";
import type { CRMActivityEntry } from "@civitasone/types";

function act(id: string, dueDate: string, status = "open"): CRMActivityEntry {
  return {
    id,
    type: "task",
    subject: `Task ${id}`,
    relatedTo: undefined,
    relatedType: undefined,
    dueDate,
    completedAt: undefined,
    owner: "Ravi",
    status,
  } as unknown as CRMActivityEntry;
}

describe("ActivitiesTable outage (GAP-CRM-ACTIVITIES-02)", () => {
  it("shows a retry (not the empty copy) when source='error' and empty", () => {
    render(<ActivitiesTable activities={[]} source="error" today="2026-03-11" />);
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.queryByText("No activities yet")).not.toBeInTheDocument();
    // Segment control is hidden on the error branch.
    expect(screen.queryByText("Overdue")).not.toBeInTheDocument();
  });

  it("still shows the empty state for an empty but valid (api) list", () => {
    render(<ActivitiesTable activities={[]} source="api" today="2026-03-11" />);
    expect(screen.getByText("No activities yet")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
  });
});

describe("ActivitiesTable Today segment uses IST (GAP-CRM-ACTIVITIES-03)", () => {
  it("includes a row whose dueDate equals the IST today, matched to the stat", () => {
    const rows = [act("1", "2026-03-11"), act("2", "2026-03-12")];
    render(
      <ActivitiesTable activities={rows} source="api" initialSegment="Today" today="2026-03-11" />,
    );
    // Only the 2026-03-11 row is in the Today segment.
    expect(screen.getByText("Task 1")).toBeInTheDocument();
    expect(screen.queryByText("Task 2")).not.toBeInTheDocument();
  });

  it("matches a full ISO timestamp by its IST date part", () => {
    // 2026-03-10T19:00:00Z == 2026-03-11 00:30 IST.
    const rows = [act("1", "2026-03-10T19:00:00.000Z")];
    render(
      <ActivitiesTable activities={rows} source="api" initialSegment="Today" today="2026-03-11" />,
    );
    expect(screen.getByText("Task 1")).toBeInTheDocument();
  });
});

describe("ActivitiesTable filter + pagination (GAP-CRM-ACTIVITIES-05)", () => {
  it("paginates at 25 rows with a next-page control when there are more", () => {
    const rows = Array.from({ length: 30 }, (_, i) => act(`r${i}`, "2026-09-01"));
    render(<ActivitiesTable activities={rows} source="api" today="2026-03-11" />);
    // Page 1 of 2 (30 rows / 25 per page).
    expect(screen.getByText(/Page/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Next/ })).toBeInTheDocument();
    // First page shows 25 rows, so the 26th subject is not yet visible.
    expect(screen.getByText("Task r0")).toBeInTheDocument();
    expect(screen.queryByText("Task r25")).not.toBeInTheDocument();
  });

  it("exposes a filter box", () => {
    const rows = [act("1", "2026-09-01"), act("2", "2026-09-02")];
    render(
      <ActivitiesTable activities={rows} source="api" today="2026-03-11" filterPlaceholder="Filter activities…" />,
    );
    expect(screen.getByPlaceholderText("Filter activities…")).toBeInTheDocument();
  });
});

describe("ActivitiesTable segment-specific empty copy (GAP-CRM-ACTIVITIES-07)", () => {
  it("shows 'No overdue activities' when the Overdue segment has no rows", () => {
    const rows = [act("1", "2026-09-01", "open"), act("2", "2026-09-02", "completed")];
    render(
      <ActivitiesTable activities={rows} source="api" initialSegment="Overdue" today="2026-03-11" />,
    );
    expect(screen.getByText("No overdue activities")).toBeInTheDocument();
    expect(screen.queryByText("No records found")).not.toBeInTheDocument();
  });

  it("shows 'Nothing due today' when the Today segment has no rows", () => {
    const rows = [act("1", "2026-09-01", "open")];
    render(
      <ActivitiesTable activities={rows} source="api" initialSegment="Today" today="2026-03-11" />,
    );
    expect(screen.getByText("Nothing due today")).toBeInTheDocument();
    expect(screen.queryByText("No records found")).not.toBeInTheDocument();
  });
});
