import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const getEnabledModulesMock = vi.fn();
vi.mock("@/lib/moduleVisibility", () => ({
  getEnabledModules: () => getEnabledModulesMock(),
  isModuleEnabled: (enabled: string[] | null, key: string | null) => {
    if (key === null) return true;
    if (!enabled) return true;
    const k = key.toLowerCase();
    return enabled.some((n) => n === k || n.includes(k) || k.includes(n));
  },
}));

class NotFoundError extends Error {}
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new NotFoundError("NEXT_NOT_FOUND");
  },
}));

import HelpModulePage from "./page";

describe("Help module guide (GAP-HELP-MODULE-01..04)", () => {
  beforeEach(() => getEnabledModulesMock.mockReset());

  // GAP-HELP-MODULE-03: a disabled module is not served by direct URL.
  it("enabled=['finance'] + slug 'grants' shows the not-enabled state", async () => {
    getEnabledModulesMock.mockResolvedValue(["finance"]);
    render(await HelpModulePage({ params: { module: "grants" } }));
    expect(
      screen.getByRole("heading", { name: /not enabled for your office/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /back to help centre/i })).toHaveAttribute(
      "href",
      "/help",
    );
  });

  // GAP-HELP-MODULE-03: an enabled module renders.
  it("enabled=['finance'] + slug 'finance' renders the guide", async () => {
    getEnabledModulesMock.mockResolvedValue(["finance"]);
    render(await HelpModulePage({ params: { module: "finance" } }));
    expect(screen.getByRole("link", { name: /open finance/i })).toBeInTheDocument();
  });

  // GAP-HELP-MODULE-04: the h1 accessible name excludes the emoji.
  it("the h1 accessible name is the module title without the emoji", async () => {
    getEnabledModulesMock.mockResolvedValue(null); // unknown -> show all
    render(await HelpModulePage({ params: { module: "grants" } }));
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1).toHaveAccessibleName("Grants");
    expect(h1.textContent).toContain("Grants");
  });

  // GAP-HELP-MODULE-03: a step with an href renders as an anchor.
  it("renders a linked step as an anchor to the right route", async () => {
    getEnabledModulesMock.mockResolvedValue(null);
    render(await HelpModulePage({ params: { module: "grants" } }));
    expect(
      screen.getByRole("link", { name: /open grants, then installments/i }),
    ).toHaveAttribute("href", "/grants/installments");
  });

  // GAP-HELP-MODULE-01: release copy matches the direct-release UI (no "send for approval").
  it("the release steps describe the Release button, not a separate approval step", async () => {
    getEnabledModulesMock.mockResolvedValue(null);
    render(await HelpModulePage({ params: { module: "grants" } }));
    expect(screen.getByText(/click Release/i)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("Send the payment for approval");
  });

  // GAP-HELP-MODULE-02: UC copy names the Verify/Reject actions.
  it("the UC steps mention Verify and Reject", async () => {
    getEnabledModulesMock.mockResolvedValue(null);
    render(await HelpModulePage({ params: { module: "grants" } }));
    expect(screen.getByText(/click Verify to accept it, or Reject/i)).toBeInTheDocument();
  });

  // GAP-HELP-MODULE-04: an unknown slug triggers notFound().
  it("an unknown slug calls notFound()", async () => {
    getEnabledModulesMock.mockResolvedValue(null);
    await expect(HelpModulePage({ params: { module: "does-not-exist" } })).rejects.toThrow(
      /NOT_FOUND/,
    );
  });
});
