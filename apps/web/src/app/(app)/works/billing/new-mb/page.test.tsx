import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const pushMock = vi.fn();
let searchParamsMock = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
  useSearchParams: () => searchParamsMock,
}));

vi.mock("@/app/_components/ds/Toast", () => ({
  useToast: () => ({
    toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
  }),
}));

import NewMbPage from "./page";

const WORK = "11111111-1111-1111-1111-111111111111";

describe("Issue Measurement Book form", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    pushMock.mockReset();
    searchParamsMock = new URLSearchParams();
  });

  it("prefills the Work ID from the ?workId passed by the billing detail page", () => {
    searchParamsMock = new URLSearchParams(`workId=${WORK}`);
    render(<NewMbPage />);
    expect(screen.getByPlaceholderText("UUID of the work")).toHaveValue(WORK);
  });

  it("leaves Work ID empty when no param is supplied (tenant-wide entry point)", () => {
    render(<NewMbPage />);
    expect(screen.getByPlaceholderText("UUID of the work")).toHaveValue("");
  });

  it("shows a clerk-safe message, never the raw backend text, when the create fails (UX-016)", async () => {
    searchParamsMock = new URLSearchParams(`workId=${WORK}`);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ message: "mb_number already exists for this award" }), {
        status: 409,
        headers: { "content-type": "application/json" },
      }),
    );

    render(<NewMbPage />);
    fireEvent.change(screen.getByPlaceholderText("UUID of the award"), {
      target: { value: "22222222-2222-2222-2222-222222222222" },
    });
    fireEvent.change(screen.getByPlaceholderText("e.g. MB/2024-25/001"), { target: { value: "MB/2024-25/001" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));

    const alert = await screen.findByRole("alert");
    await waitFor(() => expect(alert).toHaveTextContent(/couldn't save/i));
    expect(alert.textContent).not.toMatch(/mb_number already exists/i);
    expect(alert.textContent).not.toMatch(/\b409\b/);
  });
});
