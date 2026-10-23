import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { createTranslator } from "next-intl";
import en from "@/messages/en.json";

// Server component: resolve namespaced keys against the real en messages.
vi.mock("next-intl/server", () => ({
  getTranslations: async (ns: string) => createTranslator({ locale: "en", messages: en as never, namespace: ns as never }),
}));

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
  ratingBand: "B",
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
    render(await VendorScorecardPage({ params: Promise.resolve({ id: "v1" }) }));
    expect(screen.queryByText(/No scorecard yet/i)).toBeNull();
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("SCORECARD-01: a genuine empty (source api, data null) still shows 'No scorecard yet'", async () => {
    scorecardMock.mockResolvedValue({ data: null, source: "api" });
    render(await VendorScorecardPage({ params: Promise.resolve({ id: "v1" }) }));
    expect(screen.getByText(/No scorecard yet/i)).toBeInTheDocument();
  });

  it("SCORECARD-04: shows an 'As of <date>' stamp from lastUpdated", async () => {
    scorecardMock.mockResolvedValue({ data: FULL, source: "api" });
    render(await VendorScorecardPage({ params: Promise.resolve({ id: "v1" }) }));
    // formatIndianDate renders "dd Mon yyyy" for the IST day of the instant.
    expect(screen.getByText(/As of 12 Sep 2026/)).toBeInTheDocument();
  });

  it("SCORECARD-05: an unscored dimension renders '—', not a red 0", async () => {
    scorecardMock.mockResolvedValue({ data: { ...FULL, slaScore: null, slaBreaches: null }, source: "api" });
    render(await VendorScorecardPage({ params: Promise.resolve({ id: "v1" }) }));
    const dashes = screen.getAllByText("—");
    expect(dashes.length).toBeGreaterThan(0);
    expect(screen.getByText("SLA breaches").closest(".card")).toHaveTextContent("—");
  });

  it("SCORECARD-03: a band legend explains the /100 thresholds and distinguishes it from the /5 buyer rating", async () => {
    scorecardMock.mockResolvedValue({ data: FULL, source: "api" });
    render(await VendorScorecardPage({ params: Promise.resolve({ id: "v1" }) }));
    // GAP-...-SCORECARD-03: thresholds match the backend bands (A>=85, B>=70, C>=50).
    expect(screen.getByText(/A ≥ 85, B 70–84, C 50–69, D below 50/)).toBeInTheDocument();
    expect(screen.queryByText(/Excellent ≥ 90/)).toBeNull();
    expect(screen.getByText(/buyer rating/i)).toBeInTheDocument();
    // the band pill shows the backend band
    expect(screen.getByText("B")).toBeInTheDocument();
  });

  it("SCORECARD-04: no three-axis radar duplicates the bars; the breakdown carries every value as text", async () => {
    scorecardMock.mockResolvedValue({ data: FULL, source: "api" });
    render(await VendorScorecardPage({ params: Promise.resolve({ id: "v1" }) }));
    expect(screen.queryByLabelText(/radar/i)).toBeNull();
    expect(screen.getByText("Score breakdown")).toBeInTheDocument();
    expect(screen.getByText("80")).toBeInTheDocument();
  });

  it("SCORECARD-05: on-time + late visibly reconcile with total orders (and flag undelivered / mismatched counts)", async () => {
    scorecardMock.mockResolvedValue({ data: FULL, source: "api" });
    const first = render(await VendorScorecardPage({ params: Promise.resolve({ id: "v1" }) }));
    expect(screen.getByRole("note")).toHaveTextContent("On-time 8 + late 2 of 10 orders.");
    first.unmount();
    scorecardMock.mockResolvedValue({ data: { ...FULL, onTimeDeliveries: 5, lateDeliveries: 2 }, source: "api" });
    const second = render(await VendorScorecardPage({ params: Promise.resolve({ id: "v1" }) }));
    expect(screen.getByRole("note")).toHaveTextContent(/3 not yet delivered/);
    second.unmount();
    scorecardMock.mockResolvedValue({ data: { ...FULL, onTimeDeliveries: 9, lateDeliveries: 4 }, source: "api" });
    render(await VendorScorecardPage({ params: Promise.resolve({ id: "v1" }) }));
    expect(screen.getByRole("note")).toHaveTextContent(/do not add up/i);
  });
});
