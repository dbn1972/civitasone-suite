import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));

import DisciplinaryPage from "./page";

describe("DisciplinaryPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });

  it("links each case row to its detail page instead of leaving it unreachable", async () => {
    // Regression test: this table had no rowLinkKey/rowLinkPrefix at all, so
    // the fully-built disciplinary/[id] detail page was unreachable from
    // anywhere in the app except by hand-typing a case UUID into the URL.
    fetchJsonMock.mockResolvedValue({
      data: [
        {
          id: "case-1",
          employee: "R. Sharma",
          department: "Revenue",
          proceeding_type: "major",
          charges: "Misconduct",
          filed_date: "2026-01-01",
          inquiry_officer: "—",
          status: "open",
        },
      ],
      source: "api",
    });

    const ui = await DisciplinaryPage();
    render(ui);

    // The DataTable links its first column (Case Ref, derived as
    // "VIG/"+id for a major case) to the row's detail page.
    const link = screen.getByRole("link", { name: "Open VIG/CASE-1" });
    expect(link).toHaveAttribute("href", "/hr/disciplinary/case-1");
  });
});
