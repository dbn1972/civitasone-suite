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

import NewBillPage from "./page";

const WORK = "11111111-1111-1111-1111-111111111111";
const AWARD = "22222222-2222-2222-2222-222222222222";
const MB = "33333333-3333-3333-3333-333333333333";

describe("Generate Bill form", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    pushMock.mockReset();
    searchParamsMock = new URLSearchParams(`workId=${WORK}&awardId=${AWARD}&mbId=${MB}`);
  });

  it("prefills work/award/mb from the query params passed by the billing detail page", () => {
    render(<NewBillPage />);
    expect(screen.getByLabelText(/Work ID/i)).toHaveValue(WORK);
    expect(screen.getByLabelText(/Award ID/i)).toHaveValue(AWARD);
    expect(screen.getByLabelText(/Measurement Book ID/i)).toHaveValue(MB);
  });

  it("posts to the real create-bill endpoint with rupee amounts converted to paise (minor units)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: { id: "bill-1", status: "draft" } }), { status: 202 }),
    );

    render(<NewBillPage />);
    fireEvent.change(screen.getByLabelText(/Bill Number/i), { target: { value: "RA/2024-25/001" } });
    fireEvent.change(screen.getByLabelText(/Gross Amount/i), { target: { value: "1000" } });
    fireEvent.change(screen.getByLabelText(/Deductions/i), { target: { value: "100" } });

    // Net-payable preview is gross - deductions, shown paise-exact.
    expect(screen.getByText("₹900.00")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Generate Bill" }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("/api/proxy/v1/works/billing/bills");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toMatchObject({
      workId: WORK,
      awardId: AWARD,
      mbId: MB,
      billMode: "e_mb",
      billNumber: "RA/2024-25/001",
      grossAmountMinor: "100000", // ₹1000.00 → 100000 paise
      deductionsMinor: "10000", //   ₹100.00  →  10000 paise
    });
  });

  it("blocks submission when deductions exceed the gross amount", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    render(<NewBillPage />);
    fireEvent.change(screen.getByLabelText(/Bill Number/i), { target: { value: "RA/1" } });
    fireEvent.change(screen.getByLabelText(/Gross Amount/i), { target: { value: "100" } });
    fireEvent.change(screen.getByLabelText(/Deductions/i), { target: { value: "150" } });
    fireEvent.click(screen.getByRole("button", { name: "Generate Bill" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/Deductions cannot exceed/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
