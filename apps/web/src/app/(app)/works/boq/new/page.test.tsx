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

import NewBoqItemPage from "./page";

const WORK = "11111111-1111-1111-1111-111111111111";

describe("Add BoQ Item form", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    pushMock.mockReset();
    searchParamsMock = new URLSearchParams();
  });

  it("prefills the Work ID from the ?workId passed by the BoQ detail page", () => {
    searchParamsMock = new URLSearchParams(`workId=${WORK}`);
    render(<NewBoqItemPage />);
    expect(screen.getByLabelText(/Work ID/i)).toHaveValue(WORK);
  });

  it("converts the rupee rate to integer paise before posting", async () => {
    searchParamsMock = new URLSearchParams(`workId=${WORK}`);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: { id: "boq-1" } }), { status: 202 }),
    );

    render(<NewBoqItemPage />);
    fireEvent.change(screen.getByLabelText(/Item description/i), { target: { value: "PCC 1:4:8" } });
    fireEvent.change(screen.getByLabelText(/^Unit/i), { target: { value: "cum" } });
    fireEvent.change(screen.getByLabelText(/Rate per unit/i), { target: { value: "12.50" } });
    fireEvent.change(screen.getByLabelText(/Quantity/i), { target: { value: "3" } });

    fireEvent.click(screen.getByRole("button", { name: "Add BoQ Item" }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("/api/proxy/v1/works/boq");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.rate).toBe("1250"); // ₹12.50 → 1250 paise
    expect(body.workId).toBe(WORK);
  });
});
