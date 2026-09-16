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

import NewTsPage from "./page";

describe("NewTsPage — UX-016 clerk-safe errors", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("shows a clerk-safe message, never the raw HTTP status, when the create fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 500 }));

    render(<NewTsPage />);
    fireEvent.change(screen.getByLabelText(/Work ID/i), {
      target: { value: "123e4567-e89b-12d3-a456-426614174000" },
    });
    fireEvent.change(screen.getByLabelText(/TS Number/i), { target: { value: "TS/2024-25/001" } });
    fireEvent.change(screen.getByLabelText(/Sanction date/i), { target: { value: "2026-01-01" } });
    fireEvent.change(screen.getByLabelText(/TS authority/i), {
      target: { value: "223e4567-e89b-12d3-a456-426614174999" },
    });
    fireEvent.change(screen.getByLabelText(/Sanction amount/i), { target: { value: "100000" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    const alert = await screen.findByRole("alert");
    await waitFor(() => expect(alert).toHaveTextContent(/couldn't save/i));
    expect(alert.textContent).not.toMatch(/\b500\b/);
  });
});
