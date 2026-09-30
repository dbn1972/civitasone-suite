import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
const getSessionNameMock = vi.fn();
vi.mock("@/lib/auth/roleGuard", () => ({
  getSessionName: () => getSessionNameMock(),
}));

import AparDetailPage from "./page";

const BASE_APPRAISAL = {
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
};

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
    getSessionNameMock.mockReset();
    getSessionNameMock.mockReturnValue("H R Officer");
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
      data: { appraisal: BASE_APPRAISAL, scores: [], history: [] },
    });

    const ui = await AparDetailPage({ params: { id: "a1" } });
    render(ui);

    expect(screen.queryByText("APAR not found")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "APAR — 2025-26" })).toBeInTheDocument();
  });
});

describe("AparDetailPage — GAP-HR-APAR-DETAIL-03/04/05/06/07", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    getSessionNameMock.mockReset();
    getSessionNameMock.mockReturnValue("H R Officer");
  });

  it("DETAIL-03: renders the Reviewing/Accepting officer remark blocks when present (previously fetched but never rendered)", async () => {
    fetchJsonMock.mockResolvedValue({
      source: "api",
      data: {
        appraisal: { ...BASE_APPRAISAL, status: "disclosed", reviewingRemarks: "Concurs with rating.", acceptingRemarks: "Well justified." },
        scores: [], history: [],
      },
    });

    const ui = await AparDetailPage({ params: { id: "a1" } });
    render(ui);

    expect(screen.getByText("Concurs with rating.")).toBeInTheDocument();
    expect(screen.getByText("Well justified.")).toBeInTheDocument();
  });

  it("DETAIL-03: the appraisee's own pre-disclosure view has these fields redacted server-side, and the page simply renders nothing for them (no extra client gating needed)", async () => {
    fetchJsonMock.mockResolvedValue({
      source: "api",
      data: {
        // Mirrors exactly what services/hrms-service's
        // redactForAppraiseePreDisclosure sends the appraisee before
        // disclosure: the officer-only fields come back null.
        appraisal: { ...BASE_APPRAISAL, status: "reporting_officer", reportingPenPicture: null, reviewingRemarks: null, acceptingRemarks: null, overallGrade: null },
        scores: [], history: [],
      },
    });

    const ui = await AparDetailPage({ params: { id: "a1" } });
    render(ui);

    expect(screen.queryByText("Reviewing Officer — Remarks")).not.toBeInTheDocument();
    expect(screen.queryByText("Accepting Authority — Remarks")).not.toBeInTheDocument();
  });

  it("DETAIL-04: stage-history shows actor role, an Override marker, and a real date+time (not a raw ISO string)", async () => {
    fetchJsonMock.mockResolvedValue({
      source: "api",
      data: {
        appraisal: BASE_APPRAISAL,
        scores: [],
        history: [
          {
            id: "h1", fromStage: "accepting_authority", toStage: "disclosed",
            actorId: "actor-1", actorRole: "super_admin", override: true,
            remarks: "override note", createdAt: "2026-04-17T08:35:00Z",
          },
        ],
      },
    });

    const ui = await AparDetailPage({ params: { id: "a1" } });
    render(ui);

    expect(screen.getByText("super_admin")).toBeInTheDocument();
    expect(screen.getByText("Yes — privileged override")).toBeInTheDocument();
    // IST is UTC+5:30 -- 08:35 UTC on 2026-04-17 is 14:05 IST, same day.
    expect(screen.getByText(/17\/04\/2026 14:05/)).toBeInTheDocument();
  });

  it("DETAIL-04: a non-override row shows no Override marker text", async () => {
    fetchJsonMock.mockResolvedValue({
      source: "api",
      data: {
        appraisal: BASE_APPRAISAL,
        scores: [],
        history: [
          { id: "h1", fromStage: "self_pending", toStage: "reporting_officer", actorId: "actor-1", actorRole: "appraisee", override: false, remarks: null, createdAt: "2026-04-01T00:00:00Z" },
        ],
      },
    });

    const ui = await AparDetailPage({ params: { id: "a1" } });
    render(ui);

    expect(screen.queryByText("Yes — privileged override")).not.toBeInTheDocument();
  });

  it("DETAIL-05: shows a provisional weighted score (not the plain average) before Accept, distinct from the two when weights differ", async () => {
    fetchJsonMock.mockResolvedValue({
      source: "api",
      data: {
        appraisal: { ...BASE_APPRAISAL, status: "reviewing_officer", overallGrade: null },
        scores: [
          { id: "s1", attribute: "Quality", weight: "60", score: "10", remarks: null },
          { id: "s2", attribute: "Timeliness", weight: "40", score: "2", remarks: null },
        ],
        history: [],
      },
    });

    const ui = await AparDetailPage({ params: { id: "a1" } });
    render(ui);

    // weighted: (10*60 + 2*40) / 100 = 6.8 ; plain average would be 6.0
    expect(screen.getByText("Provisional Score")).toBeInTheDocument();
    expect(screen.getByText("6.8")).toBeInTheDocument();
    expect(screen.queryByText("6.0")).not.toBeInTheDocument();
  });

  it("DETAIL-05: once overallGrade exists (post-Accept), the server-computed grade is shown as-is, not a client-recomputed provisional figure", async () => {
    fetchJsonMock.mockResolvedValue({
      source: "api",
      data: {
        appraisal: { ...BASE_APPRAISAL, status: "disclosed", overallGrade: "7.50", overallBand: "Very Good" },
        scores: [{ id: "s1", attribute: "Quality", weight: "100", score: "8", remarks: null }],
        history: [],
      },
    });

    const ui = await AparDetailPage({ params: { id: "a1" } });
    render(ui);

    expect(screen.getByText("Avg Score")).toBeInTheDocument();
    expect(screen.queryByText("Provisional Score")).not.toBeInTheDocument();
    expect(screen.getByText("7.50")).toBeInTheDocument();
  });

  it("DETAIL-06: disclosedAt and representationDue both render through the shared Indian date formatter, not a raw ISO string or an unformatted date", async () => {
    fetchJsonMock.mockResolvedValue({
      source: "api",
      data: {
        appraisal: { ...BASE_APPRAISAL, status: "representation", disclosedAt: "2026-04-14T20:00:00Z", representationDue: "2026-04-29" },
        scores: [], history: [],
      },
    });

    const ui = await AparDetailPage({ params: { id: "a1" } });
    render(ui);

    expect(screen.queryByText("2026-04-14T20:00:00Z")).not.toBeInTheDocument();
    expect(screen.queryByText("2026-04-29")).not.toBeInTheDocument();
    // Both dates render as dd/MM/yyyy (formatIndianDate's current format).
    expect(screen.getAllByText(/\d{2}\/\d{2}\/2026/).length).toBeGreaterThanOrEqual(2);
  });

  it("DETAIL-07: shows the confidentiality banner on every render, independent of viewer role", async () => {
    fetchJsonMock.mockResolvedValue({
      source: "api",
      data: { appraisal: BASE_APPRAISAL, scores: [], history: [] },
    });

    const ui = await AparDetailPage({ params: { id: "a1" } });
    render(ui);

    expect(screen.getByText(/Confidential — APAR/)).toBeInTheDocument();
  });
});
