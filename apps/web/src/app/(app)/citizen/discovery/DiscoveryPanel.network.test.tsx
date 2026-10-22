import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import { DiscoveryPanel } from "./DiscoveryPanel";

function wrap(ui: React.ReactElement) {
  return render(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);
}

const UUID = "11111111-1111-4111-8111-111111111111";

describe("DiscoveryPanel error rendering (CLOS-S1-07)", () => {
  afterEach(() => vi.unstubAllGlobals());

  function stub(post: () => Promise<Response>, active = true) {
    vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) =>
      init?.method === "POST" ? post() : Promise.resolve(new Response(JSON.stringify({ active }), { status: 200 })),
    ) as unknown as typeof fetch);
  }

  it("grant consent offline shows the translated fallback, not raw 'Failed to fetch'", async () => {
    stub(() => Promise.reject(new TypeError("Failed to fetch")), false);
    wrap(<DiscoveryPanel />);
    fireEvent.change(screen.getByLabelText("Citizen ID (UUID)"), { target: { value: UUID } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(await screen.findByRole("button", { name: "Grant consent" }));
    expect(await screen.findByText(enMessages.citizenDiscovery.consentFailed)).toBeInTheDocument();
    expect(screen.queryByText("Failed to fetch")).toBeNull();
  });

  it("run discovery offline shows discoveryFailed; invalid profile JSON keeps its specific message", async () => {
    stub(() => Promise.reject(new TypeError("Failed to fetch")));
    wrap(<DiscoveryPanel />);
    fireEvent.change(screen.getByLabelText("Citizen ID (UUID)"), { target: { value: UUID } });
    fireEvent.change(screen.getByLabelText("Citizen profile (JSON)"), { target: { value: "{}" } });
    fireEvent.click(await screen.findByRole("button", { name: "Run discovery" }));
    const confirm = await screen.findAllByRole("button", { name: /run/i });
    fireEvent.click(confirm[confirm.length - 1]);
    expect(await screen.findByText(enMessages.citizenDiscovery.discoveryFailed)).toBeInTheDocument();
    expect(screen.queryByText("Failed to fetch")).toBeNull();
  });
});
