import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useParams: () => ({ id: "9f8e7d6c-1111-4222-8333-444455556666" }), useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), usePathname: () => "/", useSearchParams: () => new URLSearchParams() }));

import VerificationSessionPage from "./page";

describe("VerificationSessionPage (GAP-ASSETS-VERIFICATION-02)", () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it("lists the assets recorded against the session with found / not-found counts", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ data: [
      { id: "i1", assetId: "aaaaaaaa-0000-4000-8000-000000000001", condition: "good", foundAtLocation: true, remarks: null },
      { id: "i2", assetId: "bbbbbbbb-0000-4000-8000-000000000002", condition: "poor", foundAtLocation: false, remarks: "Moved to HQ" },
    ] }), { status: 200 }));
    render(<VerificationSessionPage />);
    expect(await screen.findByText("Moved to HQ")).toBeInTheDocument();
    expect(String(spy.mock.calls[0]![0])).toBe("/api/proxy/v1/asset/verifications/9f8e7d6c-1111-4222-8333-444455556666/items");
    expect(screen.getByText(/2 recorded · 1 found · 1 not found/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "aaaaaaaa" })).toHaveAttribute("href", "/assets/aaaaaaaa-0000-4000-8000-000000000001");
  });

  it("shows an empty state for a session with no items", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ data: [] }), { status: 200 }));
    render(<VerificationSessionPage />);
    expect(await screen.findByText("No assets recorded yet")).toBeInTheDocument();
  });

  it("shows a retryable load error (not 'empty') when the fetch fails", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("boom", { status: 500 }));
    render(<VerificationSessionPage />);
    expect(await screen.findByRole("button", { name: /Retry|Try again/i })).toBeInTheDocument();
    expect(screen.queryByText("No assets recorded yet")).not.toBeInTheDocument();
    spy.mockResolvedValue(new Response(JSON.stringify({ data: [] }), { status: 200 }));
    fireEvent.click(screen.getByRole("button", { name: /Retry|Try again/i }));
    await waitFor(() => expect(screen.getByText("No assets recorded yet")).toBeInTheDocument());
  });
});
