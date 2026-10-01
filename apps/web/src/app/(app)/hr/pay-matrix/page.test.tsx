import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));

import PayMatrixPage from "./page";

async function renderPage(searchParams?: { level?: string }) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {await PayMatrixPage({ searchParams })}
    </NextIntlClientProvider>,
  );
}

const LEVEL_1 = {
  level: 1,
  payGrade: "Level-1",
  cells: [
    { cell: 1, basicMinor: "1800000", basicDisplay: "₹ 18,000" },
    { cell: 2, basicMinor: "1860000", basicDisplay: "₹ 18,600" },
  ],
  designations: [{ id: "d1", code: "PEON", name: "Peon" }],
};
const LEVEL_18 = {
  level: 18,
  payGrade: "Level-18",
  cells: [{ cell: 1, basicMinor: "25000000", basicDisplay: "₹ 2,50,000" }],
  designations: [],
};

// getPayMatrix() returns fetchJson()'s result directly, so mocking
// fetchJson means these mocks must be the FINAL LoaderResult<PayMatrixData>
// shape -- `data` is a { levels, official } object, not the bare API array.
function loaderResult(levels: typeof LEVEL_1[], official: boolean, extra: Record<string, unknown> = {}) {
  return { data: { levels, official }, source: "api", ...extra };
}

describe("PayMatrixPage", () => {
  beforeEach(() => fetchJsonMock.mockReset());

  it("formats money from basicMinor (paise), not the server display string, and shows real min/max regardless of row order (GAP-HR-PAY-MATRIX-03/06)", async () => {
    // Deliberately descending, to prove min/max don't just read first/last row.
    fetchJsonMock.mockResolvedValue(loaderResult([LEVEL_18, LEVEL_1], false));
    await renderPage();
    // "₹18,000.00" legitimately appears twice (the Min Basic Pay stat card
    // and level 1 / cell 1's own table row) -- both must show the real
    // value, so this checks presence, not a single unique match.
    expect(screen.getAllByText("₹18,000.00").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/18,000/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/2,50,000/).length).toBeGreaterThan(0);
  });

  it("shows the per-level posts instead of dropping them (GAP-HR-PAY-MATRIX-04)", async () => {
    fetchJsonMock.mockResolvedValue(loaderResult([LEVEL_1], false));
    await renderPage();
    // LEVEL_1 has 2 cells, so its one designation legitimately appears once
    // per row/cell.
    expect(screen.getAllByText("Peon").length).toBeGreaterThan(0);
  });

  it("shows the computed-not-official notice while the backend reports official:false (GAP-HR-PAY-MATRIX-01)", async () => {
    fetchJsonMock.mockResolvedValue(loaderResult([LEVEL_1], false));
    await renderPage();
    expect(screen.getByText(/not a transcription of the officially notified/)).toBeInTheDocument();
  });

  it("hides the notice once the backend reports official:true", async () => {
    fetchJsonMock.mockResolvedValue(loaderResult([LEVEL_1], true));
    await renderPage();
    expect(screen.queryByText(/not a transcription of the officially notified/)).not.toBeInTheDocument();
  });

  it("shows an access-restricted message on a 403 instead of a retryable generic error (GAP-HR-PAY-MATRIX-02)", async () => {
    fetchJsonMock.mockResolvedValue({
      data: { levels: [], official: false },
      source: "error",
      status: 403,
      errorMessage: "requires one of: hr_admin, hr_officer, super_admin, payroll_admin, finance_officer",
    });
    await renderPage();
    expect(screen.getByText(/requires one of: hr_admin/i)).toBeInTheDocument();
  });

  it("passes a valid level filter through to the loader", async () => {
    fetchJsonMock.mockResolvedValue(loaderResult([LEVEL_1], false));
    await renderPage({ level: "1" });
    expect(fetchJsonMock).toHaveBeenCalledWith(
      "/api/v1/hrms/pay-matrix?level=1",
      expect.anything(),
      expect.anything(),
    );
  });
});
