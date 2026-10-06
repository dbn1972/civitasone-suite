import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import CapaPage from "./page";

describe("CapaPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });

  // Regression: corrective_actions has no title/name/findingCode column (capa/
  // schema.ts) — the Summary cell fell through the whole fallback chain to
  // "—" for every real CAPA row, hiding the one field (a mandatory, non-null
  // `description`) that actually says what the CAPA is about.
  it("shows the CAPA's real description in the Summary column", async () => {
    fetchJsonMock.mockResolvedValueOnce({
      data: [{
        id: "11111111-2222-4333-8444-555555555555",
        status: "open",
        description: "Install fire suppression system in warehouse B",
      }],
      source: "api",
    });

    const ui = await CapaPage();
    render(ui);

    expect(screen.getByText("Install fire suppression system in warehouse B")).toBeInTheDocument();
  });

  it("shows Start (not Complete) for a freshly-created open CAPA", async () => {
    fetchJsonMock.mockResolvedValueOnce({
      data: [{ id: "11111111-2222-4333-8444-555555555555", status: "open", description: "Fix the thing" }],
      source: "api",
    });

    const ui = await CapaPage();
    render(ui);

    expect(screen.getByRole("button", { name: /start/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /complete/i })).not.toBeInTheDocument();
  });

  // GAP-INSPECTION-CAPA-05: a past due date flags the row as overdue and the
  // Due column shows a formatted date; Owner/Due columns exist.
  it("flags an overdue CAPA and shows a formatted due date", async () => {
    fetchJsonMock.mockResolvedValueOnce({
      data: [
        {
          id: "11111111-2222-4333-8444-555555555555",
          status: "in_progress",
          description: "Overdue item",
          ownerId: "99999999-2222-4333-8444-555555555555",
          dueDate: "2000-01-01",
        },
      ],
      source: "api",
    });

    const ui = await CapaPage();
    render(ui);

    expect(screen.getByText("01 Jan 2000")).toBeInTheDocument();
    const pills = Array.from(document.querySelectorAll(".pill")).map((el) => el.textContent);
    expect(pills).toContain("Overdue");
    expect(screen.getByRole("columnheader", { name: "Due" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Owner" })).toBeInTheDocument();
  });
});
