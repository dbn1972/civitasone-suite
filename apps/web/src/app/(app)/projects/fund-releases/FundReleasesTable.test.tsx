import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { FundReleasesTable, type FundReleaseRow } from "./FundReleasesTable";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const disburseProps = vi.hoisted(() => ({ calls: [] as Array<Record<string, unknown>> }));
vi.mock("./FundReleasesActions", () => ({
  DisburseButton: (props: Record<string, unknown>) => {
    disburseProps.calls.push(props);
    return <button type="button">Disburse</button>;
  },
}));

const row: FundReleaseRow = {
  id: "fr-1",
  releaseNo: "FR-2026-001",
  projectId: "scheme-9",
  schemeId: "scheme-9",
  projectName: "Rural Roads",
  amount: 5_000_000,
  status: "sanctioned",
  releaseDate: "2026-02-01",
};

describe("FundReleasesTable (GAP-PROJECTS-FUND-RELEASES-01/03/04/05)", () => {
  it("GAP-PROJECTS-FUND-RELEASES-01: hides the Disburse control when canDisburse is false", () => {
    render(<FundReleasesTable rows={[row]} canDisburse={false} />);
    expect(screen.queryByRole("button", { name: /Disburse/i })).not.toBeInTheDocument();
    expect(screen.queryByText("Actions")).not.toBeInTheDocument();
  });

  it("GAP-PROJECTS-FUND-RELEASES-01: shows the Disburse control for a sanctioned row when canDisburse is true", () => {
    render(<FundReleasesTable rows={[row]} canDisburse />);
    expect(screen.getByRole("button", { name: "Disburse" })).toBeInTheDocument();
  });

  it("GAP-PROJECTS-FUND-RELEASES-04: a sanctioned release renders a warn pill (not neutral info)", () => {
    render(<FundReleasesTable rows={[row]} canDisburse={false} />);
    const pill = screen.getByText("Sanctioned");
    expect(pill).toHaveClass("pill", "warn");
    expect(pill).not.toHaveClass("info");
  });

  it("GAP-PROJECTS-FUND-RELEASES-04: a released release renders a good pill", () => {
    render(<FundReleasesTable rows={[{ ...row, status: "released" }]} canDisburse={false} />);
    const pill = screen.getByText("Released");
    expect(pill).toHaveClass("pill", "good");
  });

  it("GAP-PROJECTS-FUND-RELEASES-05: links each row to its project", () => {
    render(<FundReleasesTable rows={[row]} canDisburse={false} />);
    const link = screen.getByRole("link", { name: /Open Rural Roads/i });
    expect(link).toHaveAttribute("href", "/projects/scheme-9");
  });

  it("GAP-PROJECTS-FUND-RELEASES-03: Disburse is keyed by schemeId, not projectId", () => {
    disburseProps.calls.length = 0;
    render(<FundReleasesTable rows={[{ ...row, projectId: "legacy-alias", schemeId: "scheme-real" }]} canDisburse />);
    expect(disburseProps.calls.at(-1)?.schemeId).toBe("scheme-real");
  });

  it("GAP-PROJECTS-FUND-RELEASES-03: a row without schemeId gets no Disburse control (fail closed)", () => {
    const { schemeId: _omit, ...legacy } = row;
    render(<FundReleasesTable rows={[legacy as FundReleaseRow]} canDisburse />);
    expect(screen.queryByRole("button", { name: "Disburse" })).not.toBeInTheDocument();
  });
});
