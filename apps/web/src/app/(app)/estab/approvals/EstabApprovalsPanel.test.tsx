import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import { EstabApprovalsPanel } from "./EstabApprovalsPanel";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("EstabApprovalsPanel — truthful states (L3)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("shows a real error with retry (NOT 'No approvals pending') when the queue fails to load", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse({ message: "boom" }, 500));

    render(<EstabApprovalsPanel />);

    // An approver must never be told "No approvals pending" when the load failed.
    await screen.findByRole("alert");
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
    expect(screen.queryByText("No approvals pending")).toBeNull();
  });

  it("shows 'No approvals pending' only on a genuine empty success", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse({ data: [] }));

    render(<EstabApprovalsPanel />);

    await screen.findByText("No approvals pending");
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
