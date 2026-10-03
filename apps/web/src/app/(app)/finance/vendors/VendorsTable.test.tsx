import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as rtlRender, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/lib/sync/resource", () => ({
  useSeededResource: (_k: string, initial: unknown) => ({ data: initial, fromCache: false, offline: false, cachedAt: null }),
}));

import { VendorsTable } from "./VendorsTable";

// VendorsTable uses next-intl (export button), so every render needs the provider.
function render(ui: React.ReactElement) {
  return rtlRender(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);
}

describe("VendorsTable (GAP-FINANCE-VENDORS-04)", () => {
  it("shows Unregistered for a vendor without a GSTIN and the GSTIN otherwise", () => {
    render(
      <VendorsTable
        vendors={[
          { id: "v1", name: "Acme", category: "Goods", pan: "ABCDE****F", gstin: null, status: "active", ratingDisplay: "x" },
          { id: "v2", name: "Beta", category: "Goods", pan: "ABCDE****G", gstin: "29ABCDE1234F1Z5", status: "active", ratingDisplay: "x" },
        ] as never}
      />,
    );
    expect(screen.getByText("Unregistered")).toBeInTheDocument();
    expect(screen.getByText("29ABCDE1234F1Z5")).toBeInTheDocument();
  });
});

// GAP-FINANCE-VENDORS-02: the export is role-gated and SERVER-authoritative (audited before the CSV is returned).
describe("VendorsTable export (GAP-FINANCE-VENDORS-02)", () => {
  const rows = [
    { id: "v1", name: "Acme", category: "Goods", pan: "ABCDE1234F", gstin: null, status: "active", ratingDisplay: "x" },
  ] as never;
  const createObjectURL = vi.fn((_blob: Blob) => "blob:x");

  beforeEach(() => {
    vi.restoreAllMocks();
    createObjectURL.mockClear();
    (globalThis.URL as unknown as { createObjectURL: unknown }).createObjectURL = createObjectURL;
    (globalThis.URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = vi.fn();
  });
  const wrapped = render;

  it("shows no export button to a user without an export role, and none by default", () => {
    wrapped(<VendorsTable vendors={rows} canExport={false} />);
    expect(screen.queryByRole("button", { name: /Export CSV/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /CSV/ })).not.toBeInTheDocument();
  });

  it("an export role calls the server endpoint (which audits first) and downloads what it returns", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ csv: "Vendor Name,PAN\nAcme,ABCDE****F", rowCount: 1 }), { status: 200 }));
    wrapped(<VendorsTable vendors={rows} canExport />);
    fireEvent.click(screen.getByRole("button", { name: /Export CSV/ }));
    await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/proxy/v1/finance/vendors/export");
    expect(init.method).toBe("POST");
    // the CSV comes from the server, never built from the rows in the browser
    const blob = createObjectURL.mock.calls[0]![0];
    const text = await new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.readAsText(blob); });
    expect(text).toContain("ABCDE****F");
  });

  it("a failed export is shown, nothing is downloaded, and it is never swallowed", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ code: "INTERNAL" }), { status: 500 }));
    wrapped(<VendorsTable vendors={rows} canExport />);
    fireEvent.click(screen.getByRole("button", { name: /Export CSV/ }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).not.toMatch(/INTERNAL|500/);
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it("a network failure is shown too", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("offline"));
    wrapped(<VendorsTable vendors={rows} canExport />);
    fireEvent.click(screen.getByRole("button", { name: /Export CSV/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/could not be completed/i);
    expect(createObjectURL).not.toHaveBeenCalled();
  });
});
