import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as rtlRender, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import LibraryIssuesPage from "./page";

function render(ui: React.ReactElement) {
  return rtlRender(
    <NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>,
  );
}

const issuesPage = {
  data: [
    {
      id: "i1",
      bookId: "b1",
      bookTitle: "Manual of Office Procedure",
      borrowerRef: "00000000-0000-0000-0000-000000000001",
      issuedAt: "2026-07-01T00:00:00.000Z",
      dueAt: "2026-07-15T00:00:00.000Z",
      status: "issued" as const,
    },
  ],
  source: "api" as const,
};

const booksPage = {
  data: [
    {
      id: "b1",
      accessionNo: "ACC-001",
      title: "Manual of Office Procedure",
      copiesTotal: 3,
      copiesAvailable: 1,
      status: "available" as const,
    },
  ],
  source: "api" as const,
};

describe("LibraryIssuesPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });

  it("renders the loans list", async () => {
    fetchJsonMock.mockResolvedValueOnce(issuesPage).mockResolvedValueOnce(booksPage);

    const ui = await LibraryIssuesPage({ searchParams: {} });
    render(ui);

    expect(screen.getAllByText("Manual of Office Procedure").length).toBeGreaterThan(0);
  });

  it("renders an empty state when there are genuinely no loans", async () => {
    fetchJsonMock.mockResolvedValueOnce({ data: [], source: "api" }).mockResolvedValueOnce(booksPage);

    const ui = await LibraryIssuesPage({ searchParams: {} });
    render(ui);

    expect(screen.getByText("No loans yet")).toBeInTheDocument();
  });

  it("shows the data-source badge (not an empty state) when the loans loader falls back on error", async () => {
    fetchJsonMock.mockResolvedValueOnce({ data: [], source: "error" }).mockResolvedValueOnce(booksPage);

    const ui = await LibraryIssuesPage({ searchParams: {} });
    render(ui);

    expect(screen.queryByText("No loans yet")).not.toBeInTheDocument();
    expect(screen.getAllByText("Couldn't load — showing nothing").length).toBeGreaterThan(0);
  });

  it("GAP-ESTAB-LIBRARY-ISSUES-02: 'On Loan' counts issued + overdue; 'Overdue' is a subset", async () => {
    const mixed = {
      data: [
        { ...issuesPage.data[0], id: "i1", status: "issued" as const },
        { ...issuesPage.data[0], id: "i2", status: "overdue" as const },
        { ...issuesPage.data[0], id: "i3", status: "returned" as const, returnedAt: "2026-07-10T00:00:00.000Z" },
      ],
      source: "api" as const,
    };
    fetchJsonMock.mockResolvedValueOnce(mixed).mockResolvedValueOnce(booksPage);

    const ui = await LibraryIssuesPage({ searchParams: {} });
    const { container } = render(ui);

    // On Loan = 2 (issued + overdue). Read the stat value from the StatCard.
    const labs = Array.from(container.querySelectorAll(".lab")).filter((n) => n.textContent === "On Loan");
    expect(labs.length).toBe(1);
    const val = labs[0].parentElement?.querySelector(".val");
    expect(val?.textContent).toBe("2");
  });

  it("GAP-ESTAB-LIBRARY-ISSUES-04: a failed loans fetch shows a retry state (not a bare badge)", async () => {
    fetchJsonMock.mockResolvedValueOnce({ data: [], source: "error" }).mockResolvedValueOnce(booksPage);

    const ui = await LibraryIssuesPage({ searchParams: {} });
    render(ui);

    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.queryByText("No loans yet")).not.toBeInTheDocument();
  });

  it("GAP-ESTAB-LIBRARY-ISSUES-05: a catalogue failure does not blank loan stats when issues loaded ok", async () => {
    fetchJsonMock.mockResolvedValueOnce(issuesPage).mockResolvedValueOnce({ data: [], source: "error" });

    const ui = await LibraryIssuesPage({ searchParams: {} });
    const { container } = render(ui);

    // issues loaded fine → On Loan should show the real count (1), not "—".
    const labs = Array.from(container.querySelectorAll(".lab")).filter((n) => n.textContent === "On Loan");
    const val = labs[0]?.parentElement?.querySelector(".val");
    expect(val?.textContent).toBe("1");
    // The form card shows the catalogue error.
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});
