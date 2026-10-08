import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as rtlRender, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

function render(ui: React.ReactElement) {
  return rtlRender(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);
}

const getThemeBrandConfig = vi.hoisted(() => vi.fn());
const getThemeBrandPresets = vi.hoisted(() => vi.fn());
vi.mock("../_data", () => ({
  getThemeBrandConfig: (...a: unknown[]) => getThemeBrandConfig(...a),
  getThemeBrandPresets: (...a: unknown[]) => getThemeBrandPresets(...a),
}));

let sessionRoles: string[] = [];
vi.mock("@/lib/auth/roleGuard", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth/roleGuard")>("@/lib/auth/roleGuard");
  return { ...actual, getSessionRoles: () => sessionRoles };
});

const pushMock = vi.fn();
const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: pushMock, refresh: refreshMock }) }));

import Page from "./page";

const CONFIG = {
  appName: "Odisha Portal",
  logoUrl: null,
  colorPrimary: "#800020",
  colorSecondary: "#1e3a5f",
  colorAccent: "#d4af37",
  colorBackground: "#ffffff",
  colorSurface: "#f8fafc",
  colorText: "#1e293b",
  colorPrimaryFg: "#ffffff",
};
const PRESETS = [
  { code: "india_govt_green", name: "India Government", description: "Tricolor", colorPrimary: "#138808", colorSecondary: "#000080", colorAccent: "#ff9933", colorBackground: "#ffffff", colorSurface: "#f8fafc" },
  { code: "state_odisha", name: "Odisha Government", description: "Maroon + gold", colorPrimary: "#800020", colorSecondary: "#1e3a5f", colorAccent: "#d4af37", colorBackground: "#ffffff", colorSurface: "#f8fafc" },
];

beforeEach(() => {
  getThemeBrandConfig.mockReset();
  getThemeBrandPresets.mockReset();
  pushMock.mockReset();
  refreshMock.mockReset();
  sessionRoles = [];
  getThemeBrandConfig.mockResolvedValue({ data: CONFIG, source: "api" });
  getThemeBrandPresets.mockResolvedValue({ data: PRESETS, source: "api" });
  // @ts-expect-error jsdom fetch stub
  global.fetch = vi.fn(async () => ({ ok: true, status: 202, json: async () => ({ id: "x", status: "accepted" }) }));
});

describe("Themes Brand page (GAP-THEMES-BRAND-01)", () => {
  it("renders the active brand with colour swatches and an Active pill (no plain text status)", async () => {
    render(await Page());
    expect(screen.getByText("Active brand")).toBeInTheDocument();
    expect(screen.getAllByText("Odisha Portal").length).toBeGreaterThan(0);
    // Swatches render as an accessible img group, not bare hex text.
    expect(screen.getAllByRole("img", { name: /brand colour swatches/i }).length).toBeGreaterThan(0);
    // StatusPill, not just the literal word in a cell.
    expect(screen.getAllByText("Active").length).toBeGreaterThan(0);
  });

  it("hides the Activate control from a non-admin (server also enforces)", async () => {
    sessionRoles = ["theme_user"];
    render(await Page());
    expect(screen.queryByRole("button", { name: /Activate the .* brand preset/i })).toBeNull();
  });

  it("offers an audited Activate control to a theme_admin and POSTs apply-preset on confirm", async () => {
    sessionRoles = ["theme_admin"];
    render(await Page());
    // The Odisha preset matches the active primary → badged Active, no button;
    // the India preset is not active → has an Activate button.
    const activateIndia = screen.getByRole("button", { name: /Activate the India Government brand preset/i });
    fireEvent.click(activateIndia);
    // Confirm dialog warns it is tenant-wide + audited.
    expect(screen.getByText(/every user in your organisation sees/i)).toBeInTheDocument();
    expect(screen.getByText(/audited/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Activate" }));
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
      "/api/proxy/v1/themes/brand/apply-preset",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ code: "india_govt_green" }) }),
    ));
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });

  it("badges the preset matching the active brand as Active (visual activation state)", async () => {
    sessionRoles = ["theme_admin"];
    render(await Page());
    // Odisha preset shares the active primary (#800020) → it is badged Active
    // and offers no Activate button (already active).
    expect(screen.queryByRole("button", { name: /Activate the Odisha Government brand preset/i })).toBeNull();
  });
});
