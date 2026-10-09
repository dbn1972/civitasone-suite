import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@/test-utils/intl-render";

vi.mock("../_data", () => ({ getLocationJurisdictionsTyped: vi.fn() }));

import * as data from "../_data";
import Page from "./page";

const loader = vi.mocked(data.getLocationJurisdictionsTyped);

describe("locations/jurisdictions page failure vs empty (round-1 review)", () => {
  it("renders a distinct error state, not the empty state, when the load fails", async () => {
    loader.mockResolvedValue({ data: [], source: "error", status: 500 });
    render(await Page());
    expect(screen.queryByText(/yet\.$/)).toBeNull();
    expect(screen.getByRole("alert")).toBeTruthy();
  });

  it("renders the empty state when the load succeeds with no rows", async () => {
    loader.mockResolvedValue({ data: [], source: "api" });
    render(await Page());
    expect(screen.getByText(/yet\.$/)).toBeTruthy();
  });
});
