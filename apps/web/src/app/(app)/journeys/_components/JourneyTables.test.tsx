import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  ActiveJourneysTable,
  JourneyDefinitionsTable,
  JourneyTriggersTable,
} from "./JourneyTables";

// GAP-JOURNEYS-ACTIVE-02 / ANALYTICS-02 / BUILDER-02 / TEMPLATES-02:
// a journey-specific table with fixed columns, a StatusPill for status, and a
// dd/MM/yyyy date — not the generic ModuleListTable where status was raw text
// and columns meant different things per row.

describe("ActiveJourneysTable", () => {
  const rows = [
    {
      id: "e1",
      journeyId: "j-123",
      profileId: "p-456",
      status: "in_progress",
      currentStepIndex: 2,
      enrolledAt: "2026-01-02T00:00:00.000Z",
      completedAt: null,
    },
  ];

  it("renders status as a StatusPill (styled), not raw text", () => {
    render(<ActiveJourneysTable rows={rows} source="api" />);
    const pill = document.querySelector("span.pill");
    expect(pill).not.toBeNull();
    expect(pill?.textContent).toMatch(/In Progress/i);
  });

  it("formats the started date as dd Mon yyyy, not raw ISO", () => {
    render(<ActiveJourneysTable rows={rows} source="api" />);
    expect(screen.getByText("02 Jan 2026")).toBeInTheDocument();
    expect(screen.queryByText(/2026-01-02T/)).not.toBeInTheDocument();
  });

  it("shows the current step as a 1-based label", () => {
    render(<ActiveJourneysTable rows={rows} source="api" />);
    expect(screen.getByText("Step 3")).toBeInTheDocument();
  });

  it("shows a retry error state (not an empty table) when source is error", () => {
    render(<ActiveJourneysTable rows={[]} source="error" />);
    expect(screen.getByText(/couldn't load/i)).toBeInTheDocument();
  });
});

describe("JourneyDefinitionsTable", () => {
  it("renders Journey / Status (pill) / Steps / Updated columns", () => {
    render(
      <JourneyDefinitionsTable
        rows={[{ id: "j1", name: "Welcome Flow", status: "active", stepCount: 4, updatedAt: "2026-03-04T00:00:00.000Z" }]}
        source="api"
      />,
    );
    expect(screen.getByText("Welcome Flow")).toBeInTheDocument();
    const pill = document.querySelector("span.pill");
    expect(pill?.textContent).toMatch(/Active/i);
    expect(screen.getByText("04 Mar 2026")).toBeInTheDocument();
  });
});

describe("JourneyTriggersTable", () => {
  it("renders trigger type and a styled status pill", () => {
    render(
      <JourneyTriggersTable
        rows={[{ id: "t1", journeyId: "j1", triggerType: "event_based", status: "active", updatedAt: null }]}
        source="api"
      />,
    );
    expect(screen.getByText("event_based")).toBeInTheDocument();
    expect(document.querySelector("span.pill")?.textContent).toMatch(/Active/i);
  });
});
