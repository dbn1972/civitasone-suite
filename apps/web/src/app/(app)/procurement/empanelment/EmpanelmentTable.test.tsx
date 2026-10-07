import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/lib/sync/resource", () => ({ useSeededResource: vi.fn() }));

import { useSeededResource } from "@/lib/sync/resource";
import { EmpanelmentTable } from "./EmpanelmentTable";
import type { EmpanelmentEntry } from "../../../_data/loaders";

const mockedHook = vi.mocked(useSeededResource);

type Prov = "live" | "cached" | "error-no-data";
function seed(data: EmpanelmentEntry[], provenance: Prov) {
  mockedHook.mockReturnValue({
    data,
    provenance,
    offline: false,
    cachedAt: provenance === "cached" ? "2026-10-01T00:00:00.000Z" : null,
    fromCache: provenance === "cached",
  } as unknown as ReturnType<typeof useSeededResource>);
}

const FUTURE = "2999-01-01";
const PAST = "2000-01-01";

const VENDORS: EmpanelmentEntry[] = [
  { id: "v1", vendorName: "Alpha", category: "Civil", validUntil: FUTURE, rating: 4.1666667, status: "Active" },
  { id: "v2", vendorName: "Beta", category: "Electrical", validUntil: FUTURE, rating: 3, status: "Active" },
  { id: "v3", vendorName: "Gamma", category: "Civil", validUntil: PAST, rating: 1, status: "Expired" },
];

describe("EmpanelmentTable", () => {
  beforeEach(() => mockedHook.mockReset());

  // GAP-PROCUREMENT-EMPANELMENT-02: rating to one decimal with /5 scale.
  it("renders rating rounded to one decimal with a /5 scale", () => {
    seed(VENDORS, "live");
    render(<EmpanelmentTable vendors={VENDORS} source="api" />);
    const table = screen.getByRole("table");
    expect(within(table).getByText("4.2/5")).toBeInTheDocument();
    expect(within(table).queryByText(/4\.1666667/)).not.toBeInTheDocument();
  });

  // GAP-PROCUREMENT-EMPANELMENT-02: average excludes Expired vendors.
  // Active ratings: 4.1666667 and 3 -> mean 3.5833 -> "3.6/5" (the Expired
  // rating of 1 must NOT drag it to (4.1666667+3+1)/3 = 2.7).
  it("averages ratings over non-Expired vendors only", () => {
    seed(VENDORS, "live");
    render(<EmpanelmentTable vendors={VENDORS} source="api" />);
    expect(screen.getByText("Avg. Rating (active)").closest(".stat")).toHaveTextContent("3.6/5");
  });

  // GAP-PROCUREMENT-EMPANELMENT-04: expiry cue computed from the date.
  it("shows an expiry cue derived from validUntil, not the status string", () => {
    seed(VENDORS, "live");
    render(<EmpanelmentTable vendors={VENDORS} source="api" />);
    const table = screen.getByRole("table");
    expect(within(table).getAllByText(/Expires in/).length).toBeGreaterThan(0);
    expect(within(table).getAllByText(/Expired/).length).toBeGreaterThan(0);
  });

  // GAP-PROCUREMENT-EMPANELMENT-01: a failed fetch with no cache is an ERROR
  // with retry — not "No empanelled vendors" and not stats reading 0.
  it("on error with no cache, shows a retry error and '—' stats, never 'No empanelled vendors'", () => {
    seed([], "error-no-data");
    render(<EmpanelmentTable vendors={[]} source="error" />);
    expect(screen.queryByText(/No empanelled vendors/i)).not.toBeInTheDocument();
    expect(screen.getByText("Total Empanelled").closest(".stat")).toHaveTextContent("—");
    expect(screen.getByText("Active").closest(".stat")).toHaveTextContent("—");
    // A real retry affordance is present.
    expect(screen.getByRole("button", { name: /try again|retry/i })).toBeInTheDocument();
  });

  // GAP-PROCUREMENT-EMPANELMENT-01: a genuine empty api result is the real
  // empty state (0 stats, "No empanelled vendors"), distinct from an error.
  it("on a genuine empty api result, shows the real empty state with 0 stats", () => {
    seed([], "live");
    render(<EmpanelmentTable vendors={[]} source="api" />);
    expect(screen.getByText(/No empanelled vendors/i)).toBeInTheDocument();
    expect(screen.getByText("Total Empanelled").closest(".stat")).toHaveTextContent("0");
  });

  // GAP-PROCUREMENT-EMPANELMENT-03: cache-hit stats match the rendered rows.
  it("derives stats from cached rows so they match the table under a cache hit", () => {
    seed(VENDORS, "cached");
    render(<EmpanelmentTable vendors={[]} source="error" />);
    const stat = (label: string) =>
      screen.getAllByText(label).map((el) => el.closest(".stat")).find(Boolean) as HTMLElement;
    expect(stat("Total Empanelled")).toHaveTextContent("3");
    expect(stat("Active")).toHaveTextContent("2");
  });
});
