import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({ fetchJson: (...a: unknown[]) => fetchJsonMock(...a) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import CondemnationPage from "./page";
import { mapRecommendations, mapSurveys, mapAuctions } from "./readModels";

describe("CondemnationPage", () => {
  it("renders the heading and all three workflow panels fed from the read models", async () => {
    fetchJsonMock.mockImplementation(async (path: string, empty: unknown) => ({ data: empty, source: path.includes("auctions") ? "error" : "api" }));
    render(await CondemnationPage());
    expect(screen.getByRole("heading", { level: 1, name: "Condemnation, Auction & Disposal" })).toBeInTheDocument();
    expect(screen.getByText("1. Condemnation survey")).toBeInTheDocument();
    expect(screen.getByText("2. Committee recommendation (maker-checker)")).toBeInTheDocument();
    expect(screen.getByText("3. Auction")).toBeInTheDocument();
    const paths = fetchJsonMock.mock.calls.map((c) => c[0] as string);
    expect(paths).toEqual(expect.arrayContaining([
      "/api/v1/asset/condemnation-surveys",
      "/api/v1/asset/condemnation-recommendations",
      "/api/v1/asset/auctions",
    ]));
    expect(screen.getByLabelText(/^Open auction/)).toBeDisabled();
  });
});

describe("condemnation read-model mappers (GAP-ASSETS-CONDEMNATION-02)", () => {
  it("keeps money as paise strings and versions as integers; drops malformed rows", () => {
    expect(mapRecommendations({ data: [
      { id: "r", surveyId: "s", assetId: "a", decision: "condemn", status: "pending", version: 2, reserveValueMinor: "5000000", floorValueMinor: null },
      { id: "bad" },
    ] })).toEqual([{ id: "r", surveyId: "s", assetId: "a", decision: "condemn", status: "pending", version: 2, reserveValueMinor: "5000000", floorValueMinor: null }]);
    expect(mapSurveys({ data: [{ id: "s", assetId: "a", status: "draft", condition: "poor", surveyDate: "2026-01-01", version: 1 }] })![0]!.version).toBe(1);
    expect(mapAuctions({ data: [{ id: "u", assetId: "a", recommendationId: "r", reserveValueMinor: "1.5" }] })).toEqual([]);
    expect(mapSurveys({ nope: true })).toBeNull();
  });

  it("drops a record with no usable version instead of defaulting it to 1", () => {
    expect(mapSurveys({ data: [{ id: "s", assetId: "a", status: "draft", condition: "poor", surveyDate: "2026-01-01" }] })).toEqual([]);
    expect(mapRecommendations({ data: [{ id: "r", surveyId: "s", assetId: "a", decision: "condemn", status: "pending", version: 0 }] })).toEqual([]);
    expect(mapAuctions({ data: [{ id: "u", assetId: "a", recommendationId: "r", reserveValueMinor: "100", version: "2" }] })).toEqual([]);
  });
});
