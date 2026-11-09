/**
 * UAT b23: the footer owner comes from the signed-in tenant's own GIGW identity at runtime
 * (tenant-service), with the build-time NEXT_PUBLIC_GIGW_OWNER only as the fallback.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import { SiteIdentityLine } from "@/app/_components/AppFooter";
import { mergeGigwConfig, sanitizeTenantGigwIdentity, TENANT_GIGW_IDENTITY_URL } from "./useTenantGigwIdentity";
import { readGigwConfig } from "./departmentConfig";

const renderLine = () => render(
  <NextIntlClientProvider locale="en" messages={enMessages}>
    <SiteIdentityLine />
  </NextIntlClientProvider>,
);
const respond = (body: unknown, ok = true) =>
  vi.fn().mockResolvedValue({ ok, status: ok ? 200 : 401, json: async () => body });

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete process.env.NEXT_PUBLIC_GIGW_OWNER;
});

describe("sanitizeTenantGigwIdentity / mergeGigwConfig", () => {
  it("keeps only known, non-blank string fields", () => {
    expect(sanitizeTenantGigwIdentity({ identity: { department: " Digital India Corporation ", wimEmail: "  ", evil: "x", address: 5 } }))
      .toEqual({ department: "Digital India Corporation" });
    expect(sanitizeTenantGigwIdentity({ identity: null })).toBeNull();
    expect(sanitizeTenantGigwIdentity({})).toBeNull();
    expect(sanitizeTenantGigwIdentity(null)).toBeNull();
  });

  it("tenant values win; build-time config fills the rest", () => {
    process.env.NEXT_PUBLIC_GIGW_OWNER = "Municipal Corporation of Civitas Nagar";
    process.env.NEXT_PUBLIC_GIGW_ADDRESS = "Civitas Nagar Civic Centre";
    const merged = mergeGigwConfig(readGigwConfig(), { department: "Sundarpur Municipal Corporation" });
    expect(merged.department).toBe("Sundarpur Municipal Corporation");
    expect(merged.address).toBe("Civitas Nagar Civic Centre");
    expect(mergeGigwConfig(readGigwConfig(), null).department).toBe("Municipal Corporation of Civitas Nagar");
    delete process.env.NEXT_PUBLIC_GIGW_ADDRESS;
  });
});

describe("footer owner line reads the tenant at runtime", () => {
  it("shows the signed-in tenant's department instead of the build-time owner", async () => {
    process.env.NEXT_PUBLIC_GIGW_OWNER = "Municipal Corporation of Civitas Nagar";
    const fetchMock = respond({ identity: { department: "Sundarpur Municipal Corporation" } });
    vi.stubGlobal("fetch", fetchMock);
    renderLine();
    await waitFor(() => expect(screen.getByText(/Sundarpur Municipal Corporation/)).toBeTruthy());
    expect(screen.queryByText(/Civitas Nagar/)).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith(TENANT_GIGW_IDENTITY_URL, expect.objectContaining({ cache: "no-store" }));
  });

  it("two tenants in turn never see each other's owner (no cross-render cache)", async () => {
    vi.stubGlobal("fetch", respond({ identity: { department: "Sundarpur Municipal Corporation" } }));
    const a = renderLine();
    await waitFor(() => expect(screen.getByText(/Sundarpur Municipal Corporation/)).toBeTruthy());
    a.unmount();
    vi.stubGlobal("fetch", respond({ identity: { department: "Digital India Corporation" } }));
    renderLine();
    await waitFor(() => expect(screen.getByText(/Digital India Corporation/)).toBeTruthy());
    expect(screen.queryByText(/Sundarpur/)).toBeNull();
  });

  it("falls back to the build-time owner when the tenant has none, the call fails or is unauthenticated", async () => {
    process.env.NEXT_PUBLIC_GIGW_OWNER = "Municipal Corporation of Civitas Nagar";
    for (const f of [respond({ identity: null }), respond({}, false), vi.fn().mockRejectedValue(new Error("offline"))]) {
      vi.stubGlobal("fetch", f);
      const view = renderLine();
      await waitFor(() => expect(f).toHaveBeenCalled());
      expect(screen.getByText(/Municipal Corporation of Civitas Nagar/)).toBeTruthy();
      view.unmount();
    }
  });
});
