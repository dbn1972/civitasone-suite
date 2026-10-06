import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { StageBreakdownTable } from "./StageBreakdownTable";
import type { RankedForecastStage } from "./forecast";

function stage(partial: Partial<RankedForecastStage>): RankedForecastStage {
  return {
    stageId: "s1",
    stageName: "Proposal",
    probability: 50,
    weightedTotalMinor: "100000",
    sharePct: 33.33,
    band: "medium",
    ...partial,
  };
}

describe("StageBreakdownTable", () => {
  // GAP-CRM-FORECAST-05: the likelihood thresholds and the share-truncation
  // caveat are shown to the user (previously hidden).
  it("shows the likelihood thresholds and a share-truncation footnote", () => {
    render(<StageBreakdownTable stages={[stage({})]} />);
    expect(screen.getByText(/Likely/)).toBeInTheDocument();
    expect(screen.getByText(/≥ 70%/)).toBeInTheDocument();
    expect(screen.getByText(/30–69%/)).toBeInTheDocument();
    expect(screen.getByText(/< 30%/)).toBeInTheDocument();
    expect(screen.getByText(/truncated to two\s+decimals and may total slightly under 100%/i)).toBeInTheDocument();
  });

  // GAP-CRM-FORECAST-04: two stages that share a name (different stageIds, from
  // two pipelines in the all-pipelines view) must render as distinguishable rows.
  it("disambiguates two stages that share a name", () => {
    const stages = [
      stage({ stageId: "aaaaaaaa-1111-2222-3333-444444444444", stageName: "Proposal" }),
      stage({ stageId: "bbbbbbbb-5555-6666-7777-888888888888", stageName: "Proposal" }),
    ];
    render(<StageBreakdownTable stages={stages} />);
    const table = screen.getByRole("table");
    // Each row carries the stageId prefix so they are no longer identical.
    expect(within(table).getByText(/Proposal · aaaaaaaa/)).toBeInTheDocument();
    expect(within(table).getByText(/Proposal · bbbbbbbb/)).toBeInTheDocument();
    // A plain, undecorated "Proposal" cell must not exist (both were disambiguated).
    expect(within(table).queryByText("Proposal")).not.toBeInTheDocument();
  });

  // A unique stage name is left untouched (no gratuitous suffix).
  it("leaves a unique stage name unchanged", () => {
    render(<StageBreakdownTable stages={[stage({ stageName: "Negotiation" })]} />);
    expect(screen.getByRole("table")).toHaveTextContent("Negotiation");
    expect(screen.queryByText(/Negotiation ·/)).not.toBeInTheDocument();
  });
});
