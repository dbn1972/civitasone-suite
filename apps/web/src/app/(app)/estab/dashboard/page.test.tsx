import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";

const getEstabDashboard = vi.fn();
const getEstabFiles = vi.fn();
vi.mock("../../../_data/loaders", () => ({
  getEstabDashboard: (...a: unknown[]) => getEstabDashboard(...a),
  getEstabFiles: (...a: unknown[]) => getEstabFiles(...a),
}));

import EstabDashboardPage from "./page";

const DASH = {
  filesPending: 12,
  meetingsToday: 2,
  vehiclesInUse: 3,
  complianceItemsDue: 5,
  slaBreached: 1,
  dakPending: 4,
  avgPendencyDays: 7,
};

describe("EstabDashboardPage — GAP-ESTAB-DASHBOARD-05", () => {
  beforeEach(() => {
    getEstabDashboard.mockReset();
    getEstabFiles.mockReset();
  });

  it("shows the vehiclesInUse figure in the pendency snapshot and does not duplicate the Avg Pendency tile there", async () => {
    getEstabDashboard.mockResolvedValue({ data: DASH, source: "api" });
    getEstabFiles.mockResolvedValue({ data: [], source: "api" });

    const ui = await EstabDashboardPage();
    render(ui);

    // The snapshot panel surfaces vehiclesInUse (previously loaded but never shown).
    const heading = screen.getByRole("heading", { name: /Pendency snapshot/i });
    const panel = heading.closest(".card") as HTMLElement;
    expect(within(panel).getByText(/Vehicles in use/i)).toBeInTheDocument();
    expect(within(panel).getByText("3")).toBeInTheDocument();

    // The snapshot no longer repeats the "Avg pendency" field (it lives in the stat tiles).
    expect(within(panel).queryByText(/Avg pendency/i)).not.toBeInTheDocument();

    // The Avg Pendency stat tile still exists at the top.
    expect(screen.getByText(/Avg Pendency \(days\)/i)).toBeInTheDocument();
  });
});

describe("EstabDashboardPage — GAP-ESTAB-DASHBOARD-02 (label matches field)", () => {
  beforeEach(() => {
    getEstabDashboard.mockReset();
    getEstabFiles.mockReset();
  });

  it("labels the filesPending tile 'Files Pending' (not the ambiguous 'Active Files')", async () => {
    getEstabDashboard.mockResolvedValue({ data: DASH, source: "api" });
    getEstabFiles.mockResolvedValue({ data: [], source: "api" });
    const ui = await EstabDashboardPage();
    render(ui);
    expect(screen.getByText("Files Pending")).toBeInTheDocument();
    expect(screen.queryByText("Active Files")).not.toBeInTheDocument();
  });
});

describe("EstabDashboardPage — GAP-ESTAB-DASHBOARD-03 (avg pendency formatting)", () => {
  beforeEach(() => {
    getEstabDashboard.mockReset();
    getEstabFiles.mockReset();
  });

  it("rounds a fractional avg pendency to one decimal, not the raw float", async () => {
    getEstabDashboard.mockResolvedValue({ data: { ...DASH, avgPendencyDays: 6.428571 }, source: "api" });
    getEstabFiles.mockResolvedValue({ data: [], source: "api" });
    const ui = await EstabDashboardPage();
    render(ui);
    expect(screen.getByText("6.4")).toBeInTheDocument();
    expect(screen.queryByText("6.428571")).not.toBeInTheDocument();
  });
});

describe("EstabDashboardPage — GAP-ESTAB-DASHBOARD-04 (recent files sorted)", () => {
  beforeEach(() => {
    getEstabDashboard.mockReset();
    getEstabFiles.mockReset();
  });

  it("lists recent files newest-first by createdDate regardless of API order", async () => {
    getEstabDashboard.mockResolvedValue({ data: DASH, source: "api" });
    getEstabFiles.mockResolvedValue({
      data: [
        { id: "f1", fileNo: "F/OLD", subject: "Old file", status: "active", createdDate: "2026-01-01", dueDate: "2026-02-01", classification: "unclassified", createdBy: "u1", tags: [] },
        { id: "f2", fileNo: "F/NEW", subject: "New file", status: "active", createdDate: "2026-09-01", dueDate: "2026-10-01", classification: "unclassified", createdBy: "u1", tags: [] },
      ],
      source: "api",
    });
    const ui = await EstabDashboardPage();
    render(ui);
    const bodyText = document.body.textContent ?? "";
    expect(bodyText.indexOf("F/NEW")).toBeLessThan(bodyText.indexOf("F/OLD"));
  });
});
