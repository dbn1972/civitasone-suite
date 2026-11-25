import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("next-intl", async (orig) => {
  const actual = await orig<typeof import("next-intl")>();
  const messages = (await import("@/messages/en.json")).default;
  return { ...actual, useTranslations: (ns?: string) => actual.createTranslator({ locale: "en", messages, namespace: ns as never }) };
});

import { RecomputeScorecard } from "./RecomputeScorecard";
beforeEach(() => vi.restoreAllMocks());
afterEach(() => vi.unstubAllGlobals());

describe("RecomputeScorecard", () => {
  it("POSTs an empty body and reports acceptance (202), not a finished recompute", async () => {
    const f = vi.fn(async () => new Response("{}", { status: 202 }));
    vi.stubGlobal("fetch", f);
    render(<RecomputeScorecard vendorId="v-1" />);
    fireEvent.click(screen.getByRole("button", { name: "Recompute scorecard" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/Request accepted/));
    expect(f).toHaveBeenCalledWith("/api/proxy/v1/procurement/vendors/v-1/scorecard/recompute", expect.objectContaining({ method: "POST", body: "{}" }));
  });

  it("shows the catalogued failure copy on a network error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    render(<RecomputeScorecard vendorId="v-1" />);
    fireEvent.click(screen.getByRole("button", { name: "Recompute scorecard" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/Couldn.t complete/));
    expect(screen.queryByText(/Failed to fetch/)).not.toBeInTheDocument();
  });
});
