import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as rtlRender, screen, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

// Rows in the "completed" state render the reviewer hand-off button, which is translated client-side.
const render = (ui: ReactElement) =>
  rtlRender(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import InspectionsPage from "./page";

function listResult(rows: unknown[], total: number | null, source = "api") {
  return { data: { rows, total }, source };
}

describe("InspectionsPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });

  it("reads the real `state` field (not `status`) so the status shows and the action button renders", async () => {
    fetchJsonMock.mockResolvedValueOnce(
      listResult([{ id: "11111111-2222-4333-8444-555555555555", state: "scheduled", entityId: "e1" }], 1),
    );

    const ui = await InspectionsPage({ searchParams: {} });
    render(ui);

    expect(screen.getAllByText("Scheduled").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Start" })).toBeInTheDocument();
  });

  it("renders an honest empty state with a CTA when there are no inspections", async () => {
    fetchJsonMock.mockResolvedValueOnce(listResult([], 0));

    const ui = await InspectionsPage({ searchParams: {} });
    render(ui);

    expect(screen.getByText("No inspections yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /go to assignments/i })).toBeInTheDocument();
    expect(screen.queryByText(/returned from the API/i)).not.toBeInTheDocument();
  });

  it("shows the error state on a real fetch failure (source: error)", async () => {
    fetchJsonMock.mockResolvedValueOnce(listResult([], null, "error"));

    const ui = await InspectionsPage({ searchParams: {} });
    render(ui);

    expect(screen.getByText("We couldn't load inspections.")).toBeInTheDocument();
    expect(screen.queryByText("No inspections yet")).not.toBeInTheDocument();
  });

  it("treats a row missing `state` as an error (schema mismatch), not an empty table", async () => {
    fetchJsonMock.mockResolvedValueOnce(
      listResult([{ id: "11111111-2222-4333-8444-555555555555", entityId: "e1" }], 1),
    );

    const ui = await InspectionsPage({ searchParams: {} });
    render(ui);

    expect(screen.getByText("We couldn't load inspections.")).toBeInTheDocument();
  });

  it("forwards ?page=2 to the loader and renders prev/next pagination", async () => {
    fetchJsonMock.mockResolvedValueOnce(
      listResult(
        [{ id: "22222222-2222-4333-8444-555555555555", state: "in_progress", entityId: "e2" }],
        100,
      ),
    );

    const ui = await InspectionsPage({ searchParams: { page: "2" } });
    render(ui);

    expect(String(fetchJsonMock.mock.calls[0]![0])).toContain("page=2");

    const pager = screen.getByRole("navigation", { name: "Pagination" });
    const prev = within(pager).getByRole("link", { name: "Previous" });
    const next = within(pager).getByRole("link", { name: "Next" });
    expect(prev).toHaveAttribute("href", "/inspection/inspections?page=1");
    expect(next).toHaveAttribute("href", "/inspection/inspections?page=3");
  });

  it("disables Next on the last page (total reached)", async () => {
    fetchJsonMock.mockResolvedValueOnce(
      listResult([{ id: "33333333-2222-4333-8444-555555555555", state: "completed" }], 1),
    );

    const ui = await InspectionsPage({ searchParams: { page: "1" } });
    render(ui);

    expect(screen.queryByRole("navigation", { name: "Pagination" })).not.toBeInTheDocument();
  });

  // GAP-INSPECTION-INSPECTIONS-01: the Inspector(s) column shows a short UUID
  // (or "—" when absent) from the jsonb assignedInspectors field.
  it("renders an Inspector(s) column and shows the first inspector short-id", async () => {
    fetchJsonMock.mockResolvedValueOnce(
      listResult(
        [
          {
            id: "44444444-2222-4333-8444-555555555555",
            state: "in_progress",
            entityId: "eeeeeeee-2222-4333-8444-555555555555",
            assignedInspectors: [
              "ffffffff-2222-4333-8444-555555555555",
              "99999999-2222-4333-8444-555555555555",
            ],
          },
        ],
        1,
      ),
    );

    const ui = await InspectionsPage({ searchParams: {} });
    render(ui);

    // Column header must be present.
    expect(screen.getByRole("columnheader", { name: "Inspector(s)" })).toBeInTheDocument();
    // First inspector short UUID + "+1" for the second.
    expect(screen.getByText("ffffffff… +1")).toBeInTheDocument();

    // GAP-INSPECTION-INSPECTIONS-01: the inspection id must be a link to the
    // detail route, not a bare text node.
    const link = screen.getByRole("link", { name: "44444444…" });
    expect(link).toHaveAttribute("href", "/inspection/inspections/44444444-2222-4333-8444-555555555555");
  });

  // GAP-INSPECTION-INSPECTIONS-01: "—" when assignedInspectors is absent.
  it("shows an em-dash in the Inspector(s) column when the field is missing", async () => {
    fetchJsonMock.mockResolvedValueOnce(
      listResult(
        [{ id: "55555555-2222-4333-8444-555555555555", state: "scheduled" }],
        1,
      ),
    );

    const ui = await InspectionsPage({ searchParams: {} });
    render(ui);

    // The inspector cell must fall back to "—".
    const rows = screen.getAllByRole("row");
    // rows[0] is the header; rows[1] is the data row.
    const dataRow = rows[1]!;
    const cells = within(dataRow).getAllByRole("cell");
    // Inspector(s) is the third data column (0-indexed: Inspection, Entity, Inspector).
    expect(cells[2]!.textContent).toBe("—");
  });
});
