import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

let searchParamsMock = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => searchParamsMock,
}));

vi.mock("@/app/_components/ds/Toast", () => ({
  useToast: () => ({
    toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
  }),
}));

import RecordMeasurementPage from "./page";

describe("RecordMeasurementPage — UX-016 clerk-safe errors", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    searchParamsMock = new URLSearchParams();
  });

  it("shows a clerk-safe message, never the raw HTTP status, when recording a measurement fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 500 }));

    render(<RecordMeasurementPage />);
    fireEvent.change(screen.getByLabelText(/Measurement Book ID/i), {
      target: { value: "123e4567-e89b-12d3-a456-426614174000" },
    });
    fireEvent.change(screen.getByLabelText(/BoQ Item ID/i), {
      target: { value: "223e4567-e89b-12d3-a456-426614174999" },
    });
    fireEvent.change(screen.getByLabelText(/^Quantity/i), { target: { value: "12.5" } });
    fireEvent.click(screen.getByRole("button", { name: "Record Measurement" }));

    const alert = await screen.findByRole("alert");
    await waitFor(() => expect(alert).toHaveTextContent(/couldn't save/i));
    expect(alert.textContent).not.toMatch(/\b500\b/);
  });
});
