import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/app/_components/ds/Toast", () => ({
  useToast: () => ({
    toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
  }),
}));

import RaiseIssuePage from "./page";

describe("RaiseIssuePage — UX-016 clerk-safe errors", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("shows a clerk-safe message, never the raw HTTP status, when raising the issue fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 500 }));

    render(<RaiseIssuePage />);
    fireEvent.change(screen.getByLabelText(/Work ID/i), {
      target: { value: "123e4567-e89b-12d3-a456-426614174000" },
    });
    fireEvent.change(screen.getByLabelText(/Description/i), { target: { value: "Crack in the retaining wall." } });
    fireEvent.click(screen.getByRole("button", { name: "Raise Issue" }));

    const alert = await screen.findByRole("alert");
    await waitFor(() => expect(alert).toHaveTextContent(/couldn't save/i));
    expect(alert.textContent).not.toMatch(/\b500\b/);
  });
});
