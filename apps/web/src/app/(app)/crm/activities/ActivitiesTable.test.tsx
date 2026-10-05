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
  it("shows a retry (not 'No interactions yet') when source='error' and empty", () => {
    render(<ActivitiesTable activities={[]} source="error" today="2026-03-11" />);
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.queryByText("No interactions yet")).not.toBeInTheDocument();
    // Segment control is hidden on the error branch.
    expect(screen.queryByText("Overdue")).not.toBeInTheDocument();
  });

  it("still shows the empty state for an empty but valid (api) list", () => {
    render(<ActivitiesTable activities={[]} source="api" today="2026-03-11" />);
    expect(screen.getByText("No interactions yet")).toBeInTheDocument();
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
