import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";

const inspections = vi.fn();
const assignments = vi.fn();
const capas = vi.fn();
vi.mock("./_data/loaders", () => ({
  getInspectionsList: () => inspections(),
  getInspectionAssignmentsList: () => assignments(),
  getInspectionCapasList: () => capas(),
}));

import InspectionHubPage from "./page";

function card(label: string): HTMLElement {
  // StatCard renders the label inside a `.lab` element within `.stat`; the nav
  // tile also contains the word "Inspections", so scope to `.lab` specifically.
  const labelEls = Array.from(document.querySelectorAll(".stat .lab")) as HTMLElement[];
  const match = labelEls.find((el) => el.textContent === label);
  if (!match) throw new Error(`no stat card labelled "${label}"`);
  return match.closest(".stat") as HTMLElement;
}

describe("InspectionHubPage", () => {
  beforeEach(() => {
    inspections.mockReset();
    assignments.mockReset();
    capas.mockReset();
  });

  // GAP-INSPECTION-HOME-02: the card shows the server's real total, not the
  // page-capped row count.
  it("shows the server-reported total on a stat card", async () => {
    inspections.mockResolvedValue({ data: { rows: new Array(50).fill({}), total: 137 }, source: "api" });
    assignments.mockResolvedValue({ data: { rows: [], total: 0 }, source: "api" });
    capas.mockResolvedValue({ data: { rows: [], total: 0 }, source: "api" });

    render(await InspectionHubPage());
    expect(within(card("Inspections")).getByText("137")).toBeInTheDocument();
  });

  // GAP-INSPECTION-HOME-02 fallback: 50 rows and no total -> "50+", never "50".
  it("shows N+ when a full page is returned without a total", async () => {
    inspections.mockResolvedValue({ data: { rows: new Array(50).fill({}), total: null }, source: "api" });
    assignments.mockResolvedValue({ data: { rows: [], total: null }, source: "api" });
    capas.mockResolvedValue({ data: { rows: [], total: null }, source: "api" });

    render(await InspectionHubPage());
    expect(within(card("Inspections")).getByText("50+")).toBeInTheDocument();
  });

  // GAP-INSPECTION-HOME-01: a failed loader shows "—" (not "0") and a Retry,
  // while the nav tiles stay visible.
  it("shows '—' and a Retry on loader error, not a fabricated 0, keeping the tiles", async () => {
    inspections.mockResolvedValue({ data: { rows: [], total: null }, source: "error" });
    assignments.mockResolvedValue({ data: { rows: [], total: 0 }, source: "api" });
    capas.mockResolvedValue({ data: { rows: [], total: 0 }, source: "api" });

    render(await InspectionHubPage());
    expect(within(card("Inspections")).getByText("—")).toBeInTheDocument();
    expect(within(card("Inspections")).queryByText("0")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
    // Tiles remain navigable.
    expect(screen.getByRole("link", { name: /Inspections/i })).toBeInTheDocument();
  });

  // GAP-INSPECTION-HOME-03: subtitle must not leak implementation wording.
  it("has user-facing subtitle copy with no 'API'/'service'/'wired'", async () => {
    inspections.mockResolvedValue({ data: { rows: [], total: 0 }, source: "api" });
    assignments.mockResolvedValue({ data: { rows: [], total: 0 }, source: "api" });
    capas.mockResolvedValue({ data: { rows: [], total: 0 }, source: "api" });

    render(await InspectionHubPage());
    const subtitle = screen.getByText(/Plans, assignments, inspections and corrective actions\./);
    expect(subtitle.textContent).not.toMatch(/\bAPI\b|service|wired/i);
  });
});
