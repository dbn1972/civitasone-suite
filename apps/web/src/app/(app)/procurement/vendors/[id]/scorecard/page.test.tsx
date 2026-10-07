import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const scorecardMock = vi.fn();
const vendorMock = vi.fn();

vi.mock("../../../../../_data/loaders", () => ({
  getProcurementVendorScorecard: (...a: unknown[]) => scorecardMock(...a),
  getProcurementVendorById: (...a: unknown[]) => vendorMock(...a),
}));

import VendorScorecardPage from "./page";

const FULL = {
  vendorId: "v1",
  overallRating: 86,
  ratingBand: "good",
  totalOrders: 10,
  onTimeDeliveries: 8,
  lateDeliveries: 2,
  qualityRejections: 1,
  slaBreaches: 0,
  deliveryScore: 80,
  qualityScore: 90,
  slaScore: 70,
  lastUpdated: "2026-09-12T06:30:00.000Z",
};

describe("VendorScorecardPage", () => {
  beforeEach(() => {
    scorecardMock.mockReset();
    vendorMock.mockReset();
    vendorMock.mockResolvedValue({ data: { name: "Acme Supplies" }, source: "api" });
  });

  it("SCORECARD-01: a fetch error shows a retryable error state, NOT 'No scorecard yet'", async () => {
    scorecardMock.mockResolvedValue({ data: null, source: "error" });
    render(await VendorScorecardPage({ params: { id: "v1" } }));
    expect(screen.queryByText(/No scorecard yet/i)).toBeNull();
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("SCORECARD-01: a genuine empty (source api, data null) still shows 'No scorecard yet'", async () => {
    scorecardMock.mockResolvedValue({ data: null, source: "api" });
    render(await VendorScorecardPage({ params: { id: "v1" } }));
    expect(screen.getByText(/No scorecard yet/i)).toBeInTheDocument();
  });

  it("SCORECARD-04: shows an 'As of <date>' stamp from lastUpdated", async () => {
    scorecardMock.mockResolvedValue({ data: FULL, source: "api" });
    render(await VendorScorecardPage({ params: { id: "v1" } }));
    // formatIndianDate renders "dd Mon yyyy" for the IST day of the instant.
    expect(screen.getByText(/As of 12 Sep 2026/)).toBeInTheDocument();
  });

  it("SCORECARD-05: an unscored dimension renders '—', not a red 0", async () => {
    scorecardMock.mockResolvedValue({ data: { ...FULL, slaScore: null, slaBreaches: null }, source: "api" });
    render(await VendorScorecardPage({ params: { id: "v1" } }));
    const dashes = screen.getAllByText("—");
    expect(dashes.length).toBeGreaterThan(0);
    expect(screen.getByText("SLA breaches").closest(".card")).toHaveTextContent("—");
  });

  it("SCORECARD-03: a band legend explains the /100 thresholds and distinguishes it from the /5 buyer rating", async () => {
    scorecardMock.mockResolvedValue({ data: FULL, source: "api" });
    render(await VendorScorecardPage({ params: { id: "v1" } }));
    expect(screen.getByText(/Excellent ≥ 90/)).toBeInTheDocument();
    expect(screen.getByText(/buyer rating/i)).toBeInTheDocument();
  });
});
