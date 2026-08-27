import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import BrandingPage from "./page";

// The real GET /v1/themes/brand handler always returns a COMPLETE row —
// either the stored config or `{ tenantId, ...DEFAULTS }` — never a partial
// object (see theme-service/src/modules/tokens/brand-routes.ts). setConfig()
// replaces state wholesale with whatever the fetch returns, so tests must
// mock a fully-shaped response too, or LivePreview's colour-derivation
// (readableForeground on config.colorAccent, etc.) blows up on `undefined`
// exactly the way a genuinely incomplete server response would.
const FULL_BRAND_CONFIG = {
  appName: "CivitasOne",
  tagline: null,
  logoUrl: null,
  logoDarkUrl: null,
  faviconUrl: null,
  loginBgUrl: null,
  footerText: null,
  poweredBy: "Powered by CivitasOne",
  colorPrimary: "#1e40af",
  colorPrimaryFg: "#ffffff",
  colorSecondary: "#64748b",
  colorAccent: "#f59e0b",
  colorBackground: "#ffffff",
  colorSurface: "#f8fafc",
  colorBorder: "#e2e8f0",
  colorText: "#1e293b",
  colorMuted: "#64748b",
  colorSuccess: "#16a34a",
  colorWarning: "#d97706",
  colorError: "#dc2626",
  fontFamily: "Inter, system-ui, sans-serif",
  fontFamilyMono: "JetBrains Mono, monospace",
  sidebarStyle: "default",
  headerStyle: "default",
  borderRadius: "0.5rem",
  customCss: null,
};

function mockFetchOk(brandOverrides: Record<string, unknown> = {}, presets: unknown[] = []) {
  const brand = { ...FULL_BRAND_CONFIG, ...brandOverrides };
  return vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/themes/brand/presets")) {
      return Promise.resolve(new Response(JSON.stringify(presets), { status: 200 }));
    }
    if (url.endsWith("/themes/brand")) {
      return Promise.resolve(new Response(JSON.stringify(brand), { status: 200 }));
    }
    return Promise.reject(new Error(`unexpected fetch: ${url}`));
  });
}

describe("BrandingPage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("loads brand config and presets through the authenticated proxy, not the un-proxied /api/v1 path", async () => {
    // GET /api/v1/themes/brand[...] has no matching Next.js route (no
    // rewrite, no route handler) and 404s against the Next server itself —
    // it never reaches theme-service. Client components must go through
    // /api/proxy/v1/... (see api/proxy/[...path]/route.ts), the same path
    // ThemeActions.tsx/PluginActions.tsx already use for mutations.
    const fetchSpy = mockFetchOk({ appName: "Test Gov Portal" }, [{ code: "ocean", name: "Ocean", colorPrimary: "#000", colorSecondary: "#111", colorAccent: "#222" }]);

    render(<BrandingPage />);

    await waitFor(() => expect(screen.getByDisplayValue("Test Gov Portal")).toBeInTheDocument());

    const calledUrls = fetchSpy.mock.calls.map(([input]) => String(input));
    expect(calledUrls).toContain("/api/proxy/v1/themes/brand");
    expect(calledUrls).toContain("/api/proxy/v1/themes/brand/presets");
    expect(calledUrls.some((u) => u.startsWith("/api/v1/"))).toBe(false);
  });

  it("shows a load error instead of silently sitting on defaults with no indication", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 404 }));

    render(<BrandingPage />);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/couldn.t load/i);
    });
  });

  it("does not claim success when the save request fails", async () => {
    mockFetchOk({ appName: "Test Gov Portal" }, []);
    render(<BrandingPage />);
    await waitFor(() => expect(screen.getByDisplayValue("Test Gov Portal")).toBeInTheDocument());

    // Dirty the form so Save becomes enabled.
    fireEvent.change(screen.getByDisplayValue("Test Gov Portal"), { target: { value: "Changed Name" } });

    // Now make the save call itself fail — this used to be unchecked
    // (no res.ok check), so the button claimed "✓ Saved!" regardless.
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ code: "INTERNAL" }), { status: 500 }));

    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/couldn.t save/i);
    });
    expect(screen.queryByRole("button", { name: /saved/i })).not.toBeInTheDocument();
  });

  it("saves through the authenticated proxy and confirms success only on a real 2xx", async () => {
    mockFetchOk({ appName: "Test Gov Portal" }, []);
    render(<BrandingPage />);
    await waitFor(() => expect(screen.getByDisplayValue("Test Gov Portal")).toBeInTheDocument());

    fireEvent.change(screen.getByDisplayValue("Test Gov Portal"), { target: { value: "Changed Name" } });

    const putSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "b1", status: "accepted" }), { status: 202 }),
    );

    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(screen.getByRole("button", { name: /saved/i })).toBeInTheDocument());

    expect(putSpy).toHaveBeenCalledWith(
      "/api/proxy/v1/themes/brand",
      expect.objectContaining({ method: "PUT" }),
    );
  });
});
