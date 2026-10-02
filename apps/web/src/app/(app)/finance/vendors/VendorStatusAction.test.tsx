import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as rtlRender, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: refreshMock }) }));

import { VendorStatusAction } from "./VendorStatusAction";

function render(ui: React.ReactElement) {
  return rtlRender(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);
}

describe("VendorStatusAction", () => {
  beforeEach(() => { vi.restoreAllMocks(); refreshMock.mockReset(); });

  it("deactivates with the current version after confirmation", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    render(<VendorStatusAction id="v1" version={3} isActive name="Acme" />);
    fireEvent.click(screen.getByRole("button", { name: "Deactivate vendor" }));
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: "Deactivate" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/proxy/v1/finance/vendors/v1");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body as string)).toEqual({ version: 3, isActive: false });
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });

  it("an inactive vendor offers Reactivate", () => {
    render(<VendorStatusAction id="v1" version={1} isActive={false} name="Acme" />);
    expect(screen.getByRole("button", { name: "Reactivate vendor" })).toBeInTheDocument();
  });
});
