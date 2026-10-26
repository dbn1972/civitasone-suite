import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

const tokensMock = vi.fn();
const latestMock = vi.fn();
let mockRoles: string[] = ["theme_admin"];

vi.mock("../../../_data/loaders", () => ({ getThemeTokens: () => tokensMock() }));
vi.mock("../_data", async () => {
  const actual = await vi.importActual<typeof import("../_data")>("../_data");
  return { ...actual, getLatestThemeRevisionVersion: () => latestMock() };
});
vi.mock("@/lib/auth/roleGuard", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth/roleGuard")>("@/lib/auth/roleGuard");
  return { ...actual, getSessionRoles: () => mockRoles };
});
// The publish control is covered by ThemeActions.test.tsx; here we only assert
// WHETHER the page renders it and with which pinned version.
vi.mock("../ThemeActions", () => ({
  ThemeActions: (p: { expectedVersion?: number }) => <div data-testid="publish" data-version={String(p.expectedVersion)} />,
}));

import TokensPage from "./page";

const tokens = { data: [{ key: "brand.primary", value: "#1a1a1a" }], source: "api" };

describe("Themes tokens page — publish gating (GAP-THEMES-TOKENS-02)", () => {
  beforeEach(() => {
    tokensMock.mockReset();
    latestMock.mockReset();
    tokensMock.mockResolvedValue(tokens);
    latestMock.mockResolvedValue({ data: 4, source: "api" });
    mockRoles = ["theme_admin"];
  });

  it("a theme admin gets the publish control pinned to the latest published version", async () => {
    render(await TokensPage());
    expect(screen.getByTestId("publish").getAttribute("data-version")).toBe("4");
  });

  it("a tenant with no published revision pins version 0", async () => {
    latestMock.mockResolvedValue({ data: 0, source: "api" });
    render(await TokensPage());
    expect(screen.getByTestId("publish").getAttribute("data-version")).toBe("0");
  });

  it("a plain theme_user sees the tokens read-only: no publish control, and no revision lookup", async () => {
    mockRoles = ["theme_user"];
    render(await TokensPage());
    expect(screen.queryByTestId("publish")).not.toBeInTheDocument();
    expect(screen.getByText(/only theme administrators can publish/i)).toBeInTheDocument();
    expect(latestMock).not.toHaveBeenCalled();
    // the palette is still readable
    expect(screen.getByText("Token palette")).toBeInTheDocument();
  });

  it("when the latest revision cannot be read, publishing is withheld rather than sent unguarded", async () => {
    latestMock.mockResolvedValue({ data: 0, source: "error", status: 500 });
    render(await TokensPage());
    expect(screen.queryByTestId("publish")).not.toBeInTheDocument();
    expect(screen.getAllByText(/try again|retry/i).length).toBeGreaterThan(0);
  });
});
