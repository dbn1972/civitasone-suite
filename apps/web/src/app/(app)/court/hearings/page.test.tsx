import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("../_data/loaders", () => ({
  getCase: vi.fn(),
  getCaseHearings: vi.fn(),
  getCases: vi.fn(),
  getHearings: vi.fn(),
  getCourtBenches: vi.fn(),
}));
vi.mock("../_data/client", () => ({
  scheduleHearing: vi.fn(),
  adjournHearing: vi.fn(),
  recordHearingOutcome: vi.fn(),
  fetchCaseHearings: vi.fn(),
  searchCases: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }),
}));

import HearingsListPage from "./page";
import { getCase, getCaseHearings, getCases, getCourtBenches } from "../_data/loaders";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const BENCH_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

beforeEach(() => {
  vi.mocked(getCases).mockResolvedValue({ data: [], source: "api" } as never);
  vi.mocked(getCase).mockResolvedValue({
    data: { id: "case-1", title: "State vs. Sharma", cnrNumber: "DLHC01", courtId: "court-1", parties: [] },
    source: "api",
  } as never);
  vi.mocked(getCaseHearings).mockResolvedValue({
    data: [
      {
        id: "h1", caseId: "case-1", benchId: BENCH_ID, scheduledDate: "2099-01-15T10:00:00.000Z",
        status: "scheduled", nextDate: null, purpose: "arguments", adjournmentReason: null, version: 1,
      },
    ],
    source: "api",
  } as never);
  vi.mocked(getCourtBenches).mockReset();
});

describe("HearingsListPage bench label (GAP-COURT-HEARINGS-05)", () => {
  it("looks up the case court's benches and renders the bench by name, not UUID", async () => {
    vi.mocked(getCourtBenches).mockResolvedValue({ data: [{ id: BENCH_ID, name: "Division Bench I" }], source: "api" } as never);
    const ui = await HearingsListPage({ searchParams: Promise.resolve({ caseId: "case-1" }) });
    const { container } = render(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);
    expect(getCourtBenches).toHaveBeenCalledWith("court-1");
    expect(screen.getByText("Division Bench I")).toBeInTheDocument();
    expect(container.textContent).not.toContain(BENCH_ID);
  });

  it("omits the bench (no UUID) when the bench lookup fails", async () => {
    vi.mocked(getCourtBenches).mockResolvedValue({ data: [], source: "error" } as never);
    const ui = await HearingsListPage({ searchParams: Promise.resolve({ caseId: "case-1" }) });
    const { container } = render(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);
    expect(container.textContent).not.toContain(BENCH_ID);
  });
});
