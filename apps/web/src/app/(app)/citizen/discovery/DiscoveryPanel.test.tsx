import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

import { DiscoveryPanel } from "./DiscoveryPanel";

function wrap(ui: React.ReactElement) {
  return render(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);
}

const UUID = "11111111-1111-4111-8111-111111111111";

function stubFetch(impl?: (url: string, init?: RequestInit) => Promise<Response>) {
  const fn = vi.fn(impl ?? (async () => new Response(JSON.stringify({ active: false }), { status: 200 })));
  vi.stubGlobal("fetch", fn as unknown as typeof fetch);
  return fn;
}

describe("DiscoveryPanel (GAP-CITIZEN-DISCOVERY-01/02/05)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("GAP-CITIZEN-DISCOVERY-05: the profile textarea starts empty (no fabricated sample as the value)", () => {
    stubFetch();
    wrap(<DiscoveryPanel />);
    const textarea = screen.getByLabelText("Citizen profile (JSON)") as HTMLTextAreaElement;
    expect(textarea.value).toBe("");
    // The sample only appears as a placeholder, never submitted as-is.
    expect(textarea.placeholder).toContain("age");
  });

  it("GAP-CITIZEN-DISCOVERY-01: Grant consent stays disabled until the attestation checkbox is ticked (and the id is a UUID)", async () => {
    stubFetch();
    wrap(<DiscoveryPanel />);
    fireEvent.change(screen.getByLabelText("Citizen ID (UUID)"), { target: { value: UUID } });
    const grant = await screen.findByRole("button", { name: "Grant consent" });
    expect(grant).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox"));
    expect(grant).not.toBeDisabled();
  });

  it("GAP-CITIZEN-DISCOVERY-02: Run discovery opens a confirmation; Cancel makes no run fetch", async () => {
    const fetchMock = stubFetch();
    wrap(<DiscoveryPanel />);
    fireEvent.change(screen.getByLabelText("Citizen ID (UUID)"), { target: { value: UUID } });
    fireEvent.change(screen.getByLabelText("Citizen profile (JSON)"), { target: { value: '{"age":40}' } });

    const run = await screen.findByRole("button", { name: "Run discovery" });
    await waitFor(() => expect(run).not.toBeDisabled());
    fireEvent.click(run);

    // The confirm dialog appears.
    expect(await screen.findByText("Run discovery and notify the citizen?")).toBeInTheDocument();
    // Cancel it.
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    // No POST to /discovery/run was made (only the consent/matches pre-loads).
    const runCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes("/discovery/run"));
    expect(runCalls.length).toBe(0);
  });

  it("GAP-CITIZEN-DISCOVERY-01: validates the citizen id as a UUID", async () => {
    stubFetch();
    wrap(<DiscoveryPanel />);
    fireEvent.change(screen.getByLabelText("Citizen ID (UUID)"), { target: { value: "not-a-uuid" } });
    expect(screen.getByText("Enter a valid citizen ID (UUID).")).toBeInTheDocument();
  });
});
