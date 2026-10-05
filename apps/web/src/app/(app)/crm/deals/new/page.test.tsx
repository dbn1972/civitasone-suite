import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/app/_components/ds/Toast", () => ({
  useToast: () => ({ toast: { success: vi.fn(), error: vi.fn() } }),
}));

import NewDealPage from "./page";

describe("NewDealPage stage options (GAP-CRM-DEALS-NEW-01)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // The contact picker fetches /v1/crm/contacts on mount; keep it quiet.
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: [] }), { status: 200 }),
    );
  });

  it("offers only open stages — no Won or Lost option on create", () => {
    render(<NewDealPage />);
    const stageSelect = screen.getByLabelText(/stage/i);
    const options = within(stageSelect).getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual(["Lead", "Proposal", "Negotiation"]);
    expect(options).not.toContain("Won");
    expect(options).not.toContain("Lost");
  });

  it("has no option whose value is a terminal/closed stage", () => {
    render(<NewDealPage />);
    const stageSelect = screen.getByLabelText(/stage/i) as HTMLSelectElement;
    const values = Array.from(stageSelect.options).map((o) => o.value);
    expect(values).not.toContain("Won");
    expect(values).not.toContain("Lost");
  });
});
