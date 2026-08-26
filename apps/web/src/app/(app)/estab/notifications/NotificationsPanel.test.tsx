import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

import { NotificationsPanel } from "./NotificationsPanel";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("NotificationsPanel — truthful states (L3)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("shows a real error with retry (NOT 'All clear') when the fetch fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse({ message: "boom" }, 500));

    render(<NotificationsPanel />);

    // "All clear" on a failed load would falsely tell an officer nothing is pending.
    await screen.findByRole("alert");
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
    expect(screen.queryByText(/All clear/i)).toBeNull();
  });

  it("shows 'All clear' only on a genuine empty success", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse({ data: [] }));

    render(<NotificationsPanel />);

    await screen.findByText(/All clear/i);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
