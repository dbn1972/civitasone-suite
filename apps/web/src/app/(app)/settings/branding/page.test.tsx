import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import BrandingPage from "./page";
import { resetSessionIdentityCache } from "@/lib/auth/useSessionIdentity";

// The branding editor now gates its Save control on the signed-in user's
// roles via useSessionIdentity() (GAP-SETTINGS-BRANDING-03 — the UI companion
// to theme-service's PUT requireRole(theme_admin/super_admin)). That hook
// fetches /api/auth/session, so the fetch mock must answer it with an admin
// role or Save stays (correctly) disabled.
const ADMIN_SESSION = { authenticated: true, userId: "u1", roles: ["theme_admin"] };

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
    if (url.endsWith("/api/auth/session")) {
      return Promise.resolve(new Response(JSON.stringify(ADMIN_SESSION), { status: 200 }));
    }
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
    resetSessionIdentityCache();
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

  it("still shows the loaded brand config even if the (non-essential) presets request fails", async () => {
    // The two GET requests are handled independently: a flaky presets
    // endpoint shouldn't discard an already-successful brand config
    // response just because they were both in flight together.
    vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/themes/brand/presets")) {
        return Promise.resolve(new Response(null, { status: 500 }));
      }
      return Promise.resolve(new Response(JSON.stringify({ ...FULL_BRAND_CONFIG, appName: "Loaded Anyway" }), { status: 200 }));
    });

    render(<BrandingPage />);

    await waitFor(() => expect(screen.getByDisplayValue("Loaded Anyway")).toBeInTheDocument());
    expect(screen.getByRole("alert")).toHaveTextContent(/presets/i);
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

    // GAP-SETTINGS-BRANDING-03: Save now opens a tenant-wide confirmation
    // dialog before the PUT; confirm it to trigger the request.
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));
    fireEvent.click(screen.getByRole("button", { name: /save branding/i }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/couldn.t save/i);
    });
    expect(screen.queryByRole("button", { name: /✓ saved/i })).not.toBeInTheDocument();
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
    fireEvent.click(screen.getByRole("button", { name: /save branding/i }));

    await waitFor(() => expect(screen.getByRole("button", { name: /✓ saved/i })).toBeInTheDocument());

    expect(putSpy).toHaveBeenCalledWith(
      "/api/proxy/v1/themes/brand",
      expect.objectContaining({ method: "PUT" }),
    );
  });

  it("recomputes a readable colorPrimaryFg and PUTs it (GAP-SETTINGS-BRANDING-01)", async () => {
    mockFetchOk({ appName: "Test Gov Portal" }, []);
    render(<BrandingPage />);
    await waitFor(() => expect(screen.getByDisplayValue("Test Gov Portal")).toBeInTheDocument());

    // Choose a light primary (#fde68a amber). colorPrimaryFg must become
    // near-black #111827, and that pair is what gets persisted.
    fireEvent.input(screen.getByLabelText("Primary"), { target: { value: "#fde68a" } });

    const putSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "b1", status: "accepted" }), { status: 202 }),
    );

    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));
    fireEvent.click(screen.getByRole("button", { name: /save branding/i }));

    await waitFor(() => expect(putSpy).toHaveBeenCalled());
    const body = JSON.parse((putSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.colorPrimary).toBe("#fde68a");
    expect(body.colorPrimaryFg).toBe("#111827");
  });

  it("blocks Save when a critical colour pair fails WCAG AA (GAP-SETTINGS-BRANDING-06)", async () => {
    // Text #cccccc on white background is ~1.6:1 — well below 4.5:1.
    mockFetchOk({ appName: "Test Gov Portal", colorText: "#cccccc", colorBackground: "#ffffff" }, []);
    render(<BrandingPage />);
    await waitFor(() => expect(screen.getByDisplayValue("Test Gov Portal")).toBeInTheDocument());

    // Dirty the form.
    fireEvent.change(screen.getByDisplayValue("Test Gov Portal"), { target: { value: "Changed" } });

    const saveBtn = screen.getByRole("button", { name: /fix contrast to save/i });
    expect(saveBtn).toBeDisabled();
    expect(screen.getByText(/hard to read/i)).toBeInTheDocument();
  });

  it("hides Save for a user without a branding-admin role (GAP-SETTINGS-BRANDING-03)", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/auth/session")) {
        return Promise.resolve(new Response(JSON.stringify({ authenticated: true, userId: "u2", roles: ["employee"] }), { status: 200 }));
      }
      if (url.endsWith("/themes/brand/presets")) {
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
      }
      return Promise.resolve(new Response(JSON.stringify({ ...FULL_BRAND_CONFIG, appName: "Readonly Portal" }), { status: 200 }));
    });

    render(<BrandingPage />);
    await waitFor(() => expect(screen.getByDisplayValue("Readonly Portal")).toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/only a tenant or theme administrator/i));

    const appNameInput = screen.getByLabelText("App Name") as HTMLInputElement;
    expect(appNameInput).toBeDisabled();
    expect(screen.getByRole("button", { name: /no changes|save/i })).toBeDisabled();
  });

  it("rejects an oversized logo file with a clear message (GAP-SETTINGS-BRANDING-04)", async () => {
    mockFetchOk({ appName: "Test Gov Portal" }, []);
    render(<BrandingPage />);
    await waitFor(() => expect(screen.getByDisplayValue("Test Gov Portal")).toBeInTheDocument());

    const bigPng = new File([new Uint8Array(300 * 1024)], "logo.png", { type: "image/png" });
    const fileInput = document.getElementById("branding-logo-file") as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [bigPng] } });

    await waitFor(() => expect(screen.getByText(/200KB or smaller/i)).toBeInTheDocument());
  });

  it("rejects a non-image file type for the logo (GAP-SETTINGS-BRANDING-04)", async () => {
    mockFetchOk({ appName: "Test Gov Portal" }, []);
    render(<BrandingPage />);
    await waitFor(() => expect(screen.getByDisplayValue("Test Gov Portal")).toBeInTheDocument());

    const exe = new File([new Uint8Array(10)], "evil.exe", { type: "application/octet-stream" });
    const fileInput = document.getElementById("branding-logo-file") as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [exe] } });

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/must be a PNG or SVG/i));
  });

  it("rejects a non-https logo URL (GAP-SETTINGS-BRANDING-04)", async () => {
    mockFetchOk({ appName: "Test Gov Portal" }, []);
    render(<BrandingPage />);
    await waitFor(() => expect(screen.getByDisplayValue("Test Gov Portal")).toBeInTheDocument());

    const urlInput = screen.getByLabelText("Logo image URL");
    fireEvent.blur(urlInput, { target: { value: "http://example.com/logo.png" } });

    await waitFor(() => expect(screen.getByText(/https:\/\/ image URL/i)).toBeInTheDocument());
  });

  // GAP2-PLATFORM-ADMIN-COLOURS-04: the ColorField label/value and the colour
  // swatch border must use theme tokens (dark-mode aware), not fixed light
  // greys (text-gray-700 / text-gray-500 / border-gray-200).
  it("ColorField labels use theme tokens, not fixed gray classes", async () => {
    mockFetchOk({ appName: "Test Gov Portal" }, []);
    const { container } = render(<BrandingPage />);
    await waitFor(() => expect(screen.getByDisplayValue("Test Gov Portal")).toBeInTheDocument());

    // The "Primary" ColorField label <p> carries the label text.
    const primaryLabel = screen.getAllByText("Primary").find((el) => el.tagName === "P");
    expect(primaryLabel).toBeDefined();
    expect(primaryLabel?.className).not.toMatch(/text-gray-700/);
    expect(primaryLabel?.style.color).toBe("var(--ink2)");

    // No colour swatch input keeps the fixed light border-gray-200.
    const colorInputs = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="color"]'));
    expect(colorInputs.length).toBeGreaterThan(0);
    for (const input of colorInputs) {
      expect(input.className).not.toMatch(/border-gray-200/);
      expect(input.style.borderColor).toBe("var(--line)");
    }
  });
});
