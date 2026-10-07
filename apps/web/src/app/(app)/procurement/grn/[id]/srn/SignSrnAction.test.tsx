import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import { SignSrnAction } from "./SignSrnAction";

describe("SignSrnAction (GAP-PROCUREMENT-GRN-DETAIL-SRN-03)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("names the GRN in the confirm dialog", async () => {
    render(<SignSrnAction srnId="s1" grnNo="GRN/2026/0007" vendor="Acme" receivedAt="2026-09-10" />);
    fireEvent.click(screen.getByRole("button", { name: "Sign & confirm receipt" }));
    expect(await screen.findByText(/GRN\/2026\/0007/)).toBeInTheDocument();
  });

  it("sends receivedAt in the sign PATCH body", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 202 }));
    render(<SignSrnAction srnId="s1" grnNo="GRN/2026/0007" receivedAt="2026-09-10" />);
    fireEvent.click(screen.getByRole("button", { name: "Sign & confirm receipt" }));
    await screen.findByText(/Sign this Store Receipt Note\?/i);
    fireEvent.click(screen.getByRole("button", { name: "Sign" }));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    const body = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.receivedAt).toContain("2026-09-10");
  });
});
