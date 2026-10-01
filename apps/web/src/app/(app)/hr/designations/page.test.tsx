import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));

import DesignationsPage from "./page";

const MOCK_ITEMS = [{ id: "d1", code: "CLK", name: "Clerk", level: 1, payGrade: "PG1" }];

// UX-017 (tranche 3): see departments/page.test.tsx's renderPage() comment
// -- same reasoning, DesignationsTable is a nested client component.
async function renderPage() {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {await DesignationsPage()}
    </NextIntlClientProvider>,
  );
}

describe("DesignationsPage", () => {
  beforeEach(() => fetchJsonMock.mockReset());

  it("renders designations and real stat counts on success", async () => {
    fetchJsonMock.mockResolvedValue({ data: MOCK_ITEMS, source: "api" });
    await renderPage();
    expect(screen.getAllByText("Total Designations").length).toBeGreaterThan(0);
    expect(screen.getAllByText("1").length).toBeGreaterThan(0);
  });

  it("shows the honest empty state when there genuinely are no designations", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });
    await renderPage();
    expect(screen.getByText("No designations yet")).toBeInTheDocument();
  });

  it("shows the error state — not zero stat cards or the empty-state prompt — on a real fetch failure", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "error" });
    await renderPage();
    expect(screen.getByText("We couldn't load designations.")).toBeInTheDocument();
    expect(screen.queryByText("No designations yet")).not.toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  /**
   * GAP-HR-DESIGNATIONS-05: level 0 means "unclassified" (rendered as "—"
   * everywhere else on this screen) and must not be counted as a real,
   * distinct level in the "Unique Levels" stat.
   */
  it("excludes unclassified (level 0) designations from the Unique Levels stat", async () => {
    fetchJsonMock.mockResolvedValue({
      data: [
        { id: "d1", code: "A", name: "A", level: 0, payGrade: null },
        { id: "d2", code: "B", name: "B", level: 4, payGrade: null },
        { id: "d3", code: "C", name: "C", level: 4, payGrade: null },
        { id: "d4", code: "D", name: "D", level: 6, payGrade: null },
      ],
      source: "api",
    });
    await renderPage();
    expect(screen.getByText("Unique Levels")).toBeInTheDocument();
    // Two distinct real levels (4, 6); level 0 does not count as a third.
    expect(screen.getAllByText("2").length).toBeGreaterThan(0);
  });
});
