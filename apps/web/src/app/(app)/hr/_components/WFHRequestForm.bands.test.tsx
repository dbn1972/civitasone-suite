import { describe, it, expect, vi, afterEach } from "vitest";
import { render as rtlRender, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
import { WFHRequestForm } from "./WFHRequestForm";

const render = (ui: React.ReactElement) => rtlRender(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);
function stubEligibility(body: unknown) {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => body }) as Response));
}
afterEach(() => vi.unstubAllGlobals());

describe("WFHRequestForm on a private-bands tenant (S8-G4)", () => {
  it("trusts the server's verdict on band rank: blocks with the band message, not the DoPT Level text", async () => {
    stubEligibility({ payLevel: null, maxPayLevel: 9, enforceGazettedExclusion: true, weeklyWfhCount: 0, payScale: "private_bands", gazetted: true, bandRank: 40, maxBandRank: 30 });
    render(<WFHRequestForm employeeId="emp-1" />);
    const err = await screen.findByTestId("gazetted-error");
    expect(err).toHaveTextContent(/grade band/i);
    expect(err).not.toHaveTextContent(/Level 1/);
    expect(screen.getByRole("button", { name: /submit request/i })).toBeDisabled();
  });

  it("does not show 'pay level could not be verified' to a band tenant that has no 7th CPC level", async () => {
    stubEligibility({ payLevel: null, maxPayLevel: 9, enforceGazettedExclusion: true, weeklyWfhCount: 0, payScale: "private_bands", gazetted: false, bandRank: 20, maxBandRank: null });
    render(<WFHRequestForm employeeId="emp-1" />);
    await screen.findByRole("button", { name: /submit request/i });
    expect(screen.queryByTestId("gazetted-error")).toBeNull();
    expect(screen.queryByTestId("paylevel-warning")).toBeNull();
  });

  it("a band tenant is NOT blocked by a stale Level 12 on its designation", async () => {
    stubEligibility({ payLevel: 12, maxPayLevel: 9, enforceGazettedExclusion: true, weeklyWfhCount: 0, payScale: "private_bands", gazetted: false, bandRank: null, maxBandRank: null });
    render(<WFHRequestForm employeeId="emp-1" />);
    await screen.findByRole("button", { name: /submit request/i });
    expect(screen.queryByTestId("gazetted-error")).toBeNull();
  });

  it("a government response (no payScale field, or cpc7) still blocks Level 12 with the original text", async () => {
    stubEligibility({ payLevel: 12, maxPayLevel: 9, enforceGazettedExclusion: true, weeklyWfhCount: 0, payScale: "cpc7", gazetted: true });
    render(<WFHRequestForm employeeId="emp-1" />);
    expect(await screen.findByTestId("gazetted-error")).toHaveTextContent(/Level 1–9/);
  });
});
