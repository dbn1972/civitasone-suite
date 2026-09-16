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

import NewContractorPage from "./page";

describe("NewContractorPage — UX-016 clerk-safe errors", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("shows a clerk-safe message, never the raw backend text, when registering a contractor fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ message: "duplicate gst constraint" }), {
        status: 409,
        headers: { "content-type": "application/json" },
      }),
    );

    render(<NewContractorPage />);
    fireEvent.change(screen.getByLabelText(/Contractor name/i), { target: { value: "ABC Constructions" } });
    fireEvent.click(screen.getByRole("button", { name: "Register Contractor" }));

    // The error banner is a plain div (no role="alert") in this component.
    await waitFor(() => expect(screen.getByText(/couldn't save/i)).toBeInTheDocument());
    expect(document.body.textContent).not.toMatch(/duplicate gst/i);
    expect(document.body.textContent).not.toMatch(/\b409\b/);
  });
});
