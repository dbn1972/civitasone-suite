import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import AparDetailPage from "./page";

/**
 * UX-009 follow-up: a genuine 404 ("this APAR record doesn't exist") and a
 * genuine fetch error ("the API call itself failed" -- network error, 5xx,
 * bad payload, missing auth/config) used to collapse into the exact same
 * "Not found" EmptyState, because fetchJson's LoaderResult only ever
 * surfaced `source: "error"` with no way to tell the two apart. fetchJson
 * now also carries the real HTTP `status` when a response was actually
 * received (see apiClient.ts), so this page can show each its own honest
 * message instead.
 */
describe("AparDetailPage — not-found vs load-error (UX-009 follow-up)", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });

  it("shows 'APAR not found' for a genuine 404 (record doesn't exist)", async () => {
    fetchJsonMock.mockResolvedValue({ data: null, source: "error", status: 404 });

    const ui = await AparDetailPage({ params: { id: "does-not-exist" } });
    render(ui);

    expect(screen.getByText("APAR not found")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
  });

  it("shows a retryable load error (NOT 'APAR not found') when the API call itself fails with a 5xx", async () => {
    fetchJsonMock.mockResolvedValue({ data: null, source: "error", status: 500 });

    const ui = await AparDetailPage({ params: { id: "a1" } });
    render(ui);

    expect(screen.queryByText("APAR not found")).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "We couldn't load APAR record." })).toBeInTheDocument();
  });

  it("also treats a network error (no HTTP status at all) as a retryable load error, never 'not found'", async () => {
    fetchJsonMock.mockResolvedValue({ data: null, source: "error" });

    const ui = await AparDetailPage({ params: { id: "a1" } });
    render(ui);

    expect(screen.queryByText("APAR not found")).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("renders the real APAR detail on a genuine successful load (regression guard)", async () => {
    fetchJsonMock.mockResolvedValue({
      source: "api",
      data: {
        appraisal: {
          id: "a1",
          employeeId: "E100",
          appraisalPeriod: "2025-26",
          status: "self_pending",
          selfAppraisal: null,
          reportingOfficerId: null,
          reviewingOfficerId: null,
          acceptingAuthorityId: null,
          reportingPenPicture: null,
          reviewingRemarks: null,
          acceptingRemarks: null,
          overallGrade: null,
          overallBand: null,
          disclosedAt: null,
          representation: null,
          representationDue: null,
        },
        scores: [],
        history: [],
      },
    });

    const ui = await AparDetailPage({ params: { id: "a1" } });
    render(ui);

    expect(screen.queryByText("APAR not found")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "APAR — 2025-26" })).toBeInTheDocument();
  });
});
