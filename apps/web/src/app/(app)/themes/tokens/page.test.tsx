import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const loaderResult: { current: { data: Array<{ key: string; value: string }>; source: "api" | "error" } } = {
  current: { data: [], source: "api" },
};

vi.mock("../../../_data/loaders", () => ({
  getThemeTokens: async () => loaderResult.current,
}));

// ThemeActions (client) and RefreshErrorState use next/navigation.
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
// RefreshErrorState localisation hook reads the client locale.
vi.mock("@/lib/errorCatalogue", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/errorCatalogue")>();
  return { ...actual, getClientLocale: () => "en" };
});

import Page from "./page";

describe("themes tokens page (GAP-THEMES-TOKENS-01/03/04)", () => {
  beforeEach(() => {
    loaderResult.current = { data: [], source: "api" };
  });

  it("on a failed load shows a retryable error state and NO publish control", async () => {
    loaderResult.current = { data: [], source: "error" };
    render(await Page());
    expect(screen.getByRole("button", { name: /try again|retry/i })).toBeInTheDocument();
    expect(screen.queryByText("Publish theme revision")).not.toBeInTheDocument();
    // the "seed the palette" nudge must not appear on an error
    expect(screen.queryByText(/seed the palette/i)).not.toBeInTheDocument();
  });

  it("on success counts rgb()/hex as colour tokens and renders the publish control", async () => {
    loaderResult.current = {
      data: [
        { key: "brand.primary", value: "#777777" },
        { key: "surface.canvas", value: "#ffffff" },
        { key: "accent", value: "rgb(0,0,0)" },
        { key: "spacing.sm", value: "8px" },
      ],
      source: "api",
    };
    render(await Page());
    expect(screen.getByText("Publish theme revision")).toBeInTheDocument();
    // 3 colour tokens (two hex + one rgb), 1 scalar
    const colourStat = screen.getByText("Colour tokens").closest(".stat");
    expect(colourStat).toHaveTextContent("3");
    // contrast panel flags the #777 on #fff pair
    expect(screen.getByText("Fails AA")).toBeInTheDocument();
  });
});
