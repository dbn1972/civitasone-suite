import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@/test-utils/intl-render";

vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("NEXT_NOT_FOUND"); },
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("../../_data", () => ({ getParcel: vi.fn(), getParcelHistory: vi.fn() }));

import * as data from "../../_data";
import Page from "./page";

const ID = "7c1f0a52-4c2e-4b53-9d1a-0c6b1b6f1001";
const parcel = { id: ID, parcelNo: "P-204", village: "Rajpur", district: "Dehradun", areaSquareMeters: 1200.5, landUse: "residential", ownershipType: "temple_trust", status: "active", boundaryPoints: 4 };
const params = () => ({ params: Promise.resolve({ id: ID }) });

beforeEach(() => {
  vi.mocked(data.getParcel).mockResolvedValue({ data: parcel, source: "api" });
  vi.mocked(data.getParcelHistory).mockResolvedValue({ data: [{ id: "e1", eventType: "ownership_changed", createdAt: "2026-10-01T04:00:00.000Z" }], source: "api" });
});

describe("locations/parcels/[id] (GAP-LOCATIONS-MAPS-MONITORING-01)", () => {
  it("shows the parcel's details with readable labels and its history in IST, and no raw ids", async () => {
    render(await Page(params()));
    expect(screen.getByRole("heading", { name: /Parcel P-204/ })).toBeTruthy();
    expect(screen.getByText("Residential")).toBeTruthy();
    expect(screen.getByText("Temple trust")).toBeTruthy();
    expect(screen.getByText("1,200.5 m²")).toBeTruthy();
    expect(screen.getByText("4 points")).toBeTruthy();
    expect(screen.getByText("Ownership changed")).toBeTruthy();
    expect(screen.getByText(/01 Oct 2026, 09:30 am IST|1 Oct 2026, 09:30 am IST/)).toBeTruthy();
    expect(document.body.textContent).not.toContain(ID);
  });

  it("is a real 404 for a parcel that does not exist, not an empty page", async () => {
    vi.mocked(data.getParcel).mockResolvedValue({ data: null, source: "error", status: 404 });
    await expect(Page(params())).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("a failed load is a retryable error state, never an empty parcel", async () => {
    vi.mocked(data.getParcel).mockResolvedValue({ data: null, source: "error", status: 502 });
    render(await Page(params()));
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.queryByText("Parcel details")).toBeNull();
  });

  it("an empty history reads as empty, a failed history reads as a failure", async () => {
    vi.mocked(data.getParcelHistory).mockResolvedValue({ data: [], source: "api" });
    const { unmount } = render(await Page(params()));
    expect(screen.getByText("No history")).toBeTruthy();
    unmount();
    vi.mocked(data.getParcelHistory).mockResolvedValue({ data: [], source: "error", status: 500 });
    render(await Page(params()));
    expect(screen.queryByText("No history")).toBeNull();
    expect(screen.getByRole("alert")).toBeTruthy();
  });
});
