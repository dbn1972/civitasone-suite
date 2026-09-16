import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/app/_components/ds/Toast", () => ({
  useToast: () => ({
    toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
  }),
}));

import NewTenderPage from "./page";

describe("NewTenderPage — UX-016 clerk-safe errors", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("shows a clerk-safe message, never the raw backend text, when creating the pre-tender fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ message: "duplicate reference number" }), {
        status: 409,
        headers: { "content-type": "application/json" },
      }),
    );

    render(<NewTenderPage />);
    fireEvent.change(screen.getByLabelText(/Work ID/i), {
      target: { value: "123e4567-e89b-12d3-a456-426614174000" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create Pre-Tender" }));

    // The error banner is a plain div (no role="alert") in this component.
    await waitFor(() => expect(screen.getByText(/couldn't save/i)).toBeInTheDocument());
    expect(document.body.textContent).not.toMatch(/duplicate reference number/i);
    expect(document.body.textContent).not.toMatch(/\b409\b/);
  });
});
