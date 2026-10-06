import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ObservationsTable } from "./ObservationsTable";
import type { AuditObservationSummary } from "@civitasone/types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

function obs(over: Partial<AuditObservationSummary>): AuditObservationSummary {
  return {
    id: "o1",
    observationNo: "OBS-1",
    title: "Finding",
    type: "internal",
    severity: "major",
    department: "Finance",
    raisedDate: "2026-03-05",
    status: "open",
    ...over,
  } as AuditObservationSummary;
}

describe("ObservationsTable risk/status labels (GAP-AUDIT-OBSERVATIONS-01)", () => {
  it("renders 'major' severity as High, not Low", () => {
    render(<ObservationsTable items={[obs({ severity: "major" })]} />);
    expect(screen.getByText("High")).toBeInTheDocument();
    expect(screen.queryByText("Low")).not.toBeInTheDocument();
  });

  it("renders 'critical' as Critical and 'observation' as Low", () => {
    render(<ObservationsTable items={[obs({ id: "a", severity: "critical" }), obs({ id: "b", severity: "observation" })]} />);
    expect(screen.getByText("Critical")).toBeInTheDocument();
    expect(screen.getByText("Low")).toBeInTheDocument();
  });

  it("renders an unknown severity as its raw text, never silently Low", () => {
    render(<ObservationsTable items={[obs({ severity: "high" as AuditObservationSummary["severity"] })]} />);
    expect(screen.getByText("high")).toBeInTheDocument();
    expect(screen.queryByText("Low")).not.toBeInTheDocument();
  });
});
