import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

import DispatchRegistryPage from "./page";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("DispatchRegistryPage — truthful states (L3)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("shows a real error with retry (NOT 'No dispatches yet') when the fetch fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse({ message: "boom" }, 500));

    render(<DispatchRegistryPage />);

    // A failed load must surface an assertive error + retry, never the empty state.
    await screen.findByRole("alert");
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
    expect(screen.queryByText("No dispatches yet")).toBeNull();
  });

  it("shows the empty state only on a genuine empty success", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse({ data: [] }));

    render(<DispatchRegistryPage />);

    await screen.findByText("No dispatches yet");
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
