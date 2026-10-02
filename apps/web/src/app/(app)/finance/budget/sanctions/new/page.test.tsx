import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: pushMock, refresh: vi.fn() }) }));

import NewSanctionPage from "./page";

const HEADS = [
  { id: "11111111-1111-4111-8111-111111111111", code: "3054", name: "Roads and Bridges", type: "expense" },
  { id: "22222222-2222-4222-8222-222222222222", code: "8443", name: "Civil Deposits", type: "liability" },
];

function mockFetch(postStatus = 202) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
    if (String(url).includes("/finance/accounts")) return new Response(JSON.stringify({ data: HEADS }), { status: 200 });
    return new Response(JSON.stringify({ data: { id: "s1", status: "accepted" } }), { status: postStatus });
  });
}
const sanctionPosts = (m: { mock: { calls: unknown[][] } }) => m.mock.calls.filter(([u]) => String(u).endsWith("/finance/sanctions"));

async function fill(amount: string) {
  render(<NewSanctionPage />);
  await waitFor(() => expect(screen.getByText("3054 · Roads and Bridges")).toBeInTheDocument());
  fireEvent.change(screen.getByLabelText("Sanction number"), { target: { value: "SAN/2026/014" } });
  fireEvent.change(screen.getByLabelText("Subject"), { target: { value: "Repair of district road" } });
  fireEvent.change(screen.getByLabelText("Budget head"), { target: { value: HEADS[0].id } });
  fireEvent.change(screen.getByLabelText("Amount (₹)"), { target: { value: amount } });
  fireEvent.click(screen.getByRole("button", { name: /submit sanction/i }));
}

describe("NewSanctionPage (GAP-FINANCE-BUDGET-SANCTIONS-01)", () => {
  beforeEach(() => { vi.restoreAllMocks(); pushMock.mockReset(); });

  it("posts the full contract with exact paise: 1250.50 -> '125050'", async () => {
    const m = mockFetch();
    await fill("1250.50");
    await waitFor(() => expect(sanctionPosts(m).length).toBe(1));
    const body = JSON.parse(String((sanctionPosts(m)[0][1] as RequestInit).body));
    expect(body).toEqual({
      sanctionNo: "SAN/2026/014", purpose: "Repair of district road",
      headId: HEADS[0].id, amountMinor: "125050",
    });
    expect(body).not.toHaveProperty("status");
    expect(await screen.findByText(/awaits approval by a different finance officer/)).toBeInTheDocument();
  });

  it("blocks an empty amount with a field error and never posts", async () => {
    const m = mockFetch();
    await fill("");
    expect(await screen.findByText(/greater than 0, with at most 2 decimals/)).toBeInTheDocument();
    expect(sanctionPosts(m).length).toBe(0);
  });

  it("offers only expenditure heads", async () => {
    mockFetch();
    render(<NewSanctionPage />);
    await waitFor(() => expect(screen.getByText("3054 · Roads and Bridges")).toBeInTheDocument());
    expect(screen.queryByText("8443 · Civil Deposits")).not.toBeInTheDocument();
  });
});
