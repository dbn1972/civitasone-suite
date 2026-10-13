import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("@/lib/sync/resource", () => ({
  useSeededResource: (_k: string, data: unknown) => ({ data, provenance: "live", offline: false, cachedAt: null }),
}));

import { IdpTable } from "./IdpTable";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import hiMessages from "@/messages/hi.json";
const withIntl = (ui: React.ReactElement, locale: "en" | "hi" = "en") => (
  <NextIntlClientProvider locale={locale} messages={locale === "en" ? enMessages : hiMessages}>{ui}</NextIntlClientProvider>
);


const providers = [
  {
    id: "p1",
    name: "Keycloak",
    protocol: "OIDC",
    status: "active",
    usersSynced: 42,
    lastSync: "2026-09-29T00:00:00Z",
    endpoint: "https://admin:secret@idp.example.gov.in/realms/corp?x=1",
  },
];

describe("IdpTable — PII/I18N (IDP-03) + export audit (IDP-04)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("masks the endpoint to scheme+host (no realm, userinfo, query)", () => {
    render(withIntl(<IdpTable providers={providers} source="api" />));
    expect(screen.getByText("https://idp.example.gov.in")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/realms\/corp/);
    expect(document.body.textContent).not.toMatch(/secret/);
  });

  it("renders lastSync with an IST label", () => {
    render(withIntl(<IdpTable providers={providers} source="api" />));
    expect(screen.getByText(/29 Sep 2026.*IST/)).toBeTruthy();
  });

  function stubDownload() {
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    (URL as unknown as { createObjectURL: () => string }).createObjectURL = () => "blob:x";
    (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = () => {};
    return click;
  }

  it("audits the export BEFORE the file is built, then downloads", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 202 }));
    const click = stubDownload();
    render(withIntl(<IdpTable providers={providers} source="api" />));
    fireEvent.click(screen.getByRole("button", { name: /CSV/ }));
    await waitFor(() => expect(click).toHaveBeenCalledTimes(1));
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/proxy/v1/admin/idp/providers/export-audit",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ rowCount: 1, filter: null }) }),
    );
  });

  it("a failed audit call shows an error and BLOCKS the export (no file)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("nope", { status: 404 }));
    const click = stubDownload();
    render(withIntl(<IdpTable providers={providers} source="api" />));
    fireEvent.click(screen.getByRole("button", { name: /CSV/ }));
    await waitFor(() => expect(screen.getByText(/Couldn't record this export/i)).toBeInTheDocument());
    expect(click).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toMatch(/404/);
  });

  it("an unreachable audit endpoint (network error) also blocks the export", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("fetch failed"));
    const click = stubDownload();
    render(withIntl(<IdpTable providers={providers} source="api" />));
    fireEvent.click(screen.getByRole("button", { name: /CSV/ }));
    await waitFor(() => expect(screen.getByText(/Couldn't record this export/i)).toBeInTheDocument());
    expect(click).not.toHaveBeenCalled();
  });

  it("shows the Hindi message when the locale is hi", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("x", { status: 500 }));
    stubDownload();
    render(withIntl(<IdpTable providers={providers} source="api" />, "hi"));
    fireEvent.click(screen.getByRole("button", { name: /CSV/ }));
    await waitFor(() => expect(screen.getByText(/ऑडिट ट्रेल में दर्ज नहीं/)).toBeInTheDocument());
  });
});
