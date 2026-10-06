import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import { HealthTable } from "./HealthTable";
import type { HealthRow } from "../_data";

const rows: HealthRow[] = [
  { id: "acc-1", accountId: "acc-1", score: 12, band: "critical", computedAt: "2026-02-01T00:00:00.000Z" },
  { id: "acc-2", accountId: "acc-2", score: 40, band: "at_risk", computedAt: "2026-02-02T00:00:00.000Z" },
];

describe("HealthTable (GAP-RECOMMENDATIONS-HEALTH-01/03)", () => {
  it("renders explicit Account/Score/Band columns, not a generic 5-col list", () => {
    render(<HealthTable rows={rows} />);
    expect(screen.getByRole("columnheader", { name: "Account" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /Score/ })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Band" })).toBeInTheDocument();
    // No generic "Name"/"Detail"/"Meta" headers.
    expect(screen.queryByRole("columnheader", { name: "Detail" })).not.toBeInTheDocument();
  });

  it("shows the numeric score for each account", () => {
    render(<HealthTable rows={rows} />);
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText("40")).toBeInTheDocument();
  });

  it("renders the band as a coloured StatusPill (critical = bad)", () => {
    const { container } = render(<HealthTable rows={rows} />);
    const bad = container.querySelector(".pill.bad");
    expect(bad).toBeTruthy();
    expect(bad).toHaveTextContent(/critical/i);
  });

  it("renders an empty state when there are no at-risk accounts", () => {
    render(<HealthTable rows={[]} />);
    expect(screen.getByText(/No at-risk accounts/i)).toBeInTheDocument();
  });
});
