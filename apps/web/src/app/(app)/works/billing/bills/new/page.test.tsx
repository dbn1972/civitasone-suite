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

/** Mock awards/mbs GETs + the bill-create POST. Returns the spy so tests can
 * inspect the POST specifically. */
function mockFetch(postStatus = 202) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    if (method === "GET" && url.endsWith(`/${WORK}/awards`)) {
      return Promise.resolve(new Response(JSON.stringify({ data: [{ id: AWARD, agreementNumber: "AGR/42", contractorName: "Acme", status: "do_finalized" }] }), { status: 200 }));
    }
    if (method === "GET" && url.endsWith(`/${WORK}/mbs`)) {
      return Promise.resolve(new Response(JSON.stringify({ data: [{ id: MB, mbNumber: "MB/01", status: "do_finalized" }] }), { status: 200 }));
    }
    return Promise.resolve(new Response(JSON.stringify({ data: { id: "bill-1", status: "draft" } }), { status: postStatus }));
  }) as typeof fetch);
}

function postCall(spy: ReturnType<typeof mockFetch>) {
  return spy.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === "POST");
}

describe("Generate Bill form", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    pushMock.mockReset();
    searchParamsMock = new URLSearchParams(`workId=${WORK}&awardId=${AWARD}&mbId=${MB}`);
  });

  it("prefills work/award/mb from the query params passed by the billing detail page", async () => {
    mockFetch();
    render(<NewBillPage />);
    expect(await screen.findByLabelText(/Work ID/i)).toHaveValue(WORK);
    // award/mb become selects once the per-work lists load; the seeded value stays selected
    await waitFor(() => expect(screen.getByLabelText(/^Award/i)).toHaveValue(AWARD));
    await waitFor(() => expect(screen.getByLabelText(/Measurement Book/i)).toHaveValue(MB));
  });

  it("posts to the real create-bill endpoint with rupee amounts converted to paise (minor units)", async () => {
    const fetchSpy = mockFetch();
    render(<NewBillPage />);
    await screen.findByLabelText(/Work ID/i);
    fireEvent.change(screen.getByLabelText(/Bill Number/i), { target: { value: "RA/2024-25/001" } });
    fireEvent.change(screen.getByLabelText(/Gross Amount/i), { target: { value: "1000" } });
    fireEvent.change(screen.getByLabelText(/Deductions/i), { target: { value: "100" } });

    expect(screen.getByText("₹900.00")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Generate Bill" }));

    await waitFor(() => expect(postCall(fetchSpy)).toBeTruthy());
    const [url, init] = postCall(fetchSpy)!;
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

  it("converts fractional rupees exactly with no float error (GAP-WORKS-BILLING-BILLS-NEW-02)", async () => {
    const fetchSpy = mockFetch();
    render(<NewBillPage />);
    await screen.findByLabelText(/Work ID/i);
    fireEvent.change(screen.getByLabelText(/Bill Number/i), { target: { value: "RA/2" } });
    fireEvent.change(screen.getByLabelText(/Gross Amount/i), { target: { value: "2.50" } });
    fireEvent.click(screen.getByRole("button", { name: "Generate Bill" }));
    await waitFor(() => expect(postCall(fetchSpy)).toBeTruthy());
    const body = JSON.parse((postCall(fetchSpy)![1] as RequestInit).body as string);
    expect(body.grossAmountMinor).toBe("250");
  });

  it("rejects a non-positive gross amount rather than posting (BILLS-NEW-02 guard)", async () => {
    const fetchSpy = mockFetch();
    render(<NewBillPage />);
    await screen.findByLabelText(/Work ID/i);
    fireEvent.change(screen.getByLabelText(/Bill Number/i), { target: { value: "RA/3" } });
    fireEvent.change(screen.getByLabelText(/Gross Amount/i), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "Generate Bill" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/valid gross amount/i);
    expect(postCall(fetchSpy)).toBeUndefined();
  });

  it("blocks submission when deductions exceed the gross amount", async () => {
    const fetchSpy = mockFetch();
    render(<NewBillPage />);
    await screen.findByLabelText(/Work ID/i);
    fireEvent.change(screen.getByLabelText(/Bill Number/i), { target: { value: "RA/1" } });
    fireEvent.change(screen.getByLabelText(/Gross Amount/i), { target: { value: "100" } });
    fireEvent.change(screen.getByLabelText(/Deductions/i), { target: { value: "150" } });
    fireEvent.click(screen.getByRole("button", { name: "Generate Bill" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/Deductions cannot exceed/i);
    expect(postCall(fetchSpy)).toBeUndefined();
  });

  it("shows a clerk-safe message, never the raw HTTP status, when the create fails (UX-016)", async () => {
    const fetchSpy = mockFetch(503);
    render(<NewBillPage />);
    await screen.findByLabelText(/Work ID/i);
    fireEvent.change(screen.getByLabelText(/Bill Number/i), { target: { value: "RA/2024-25/002" } });
    fireEvent.change(screen.getByLabelText(/Gross Amount/i), { target: { value: "1000" } });
    fireEvent.click(screen.getByRole("button", { name: "Generate Bill" }));

    const alert = await screen.findByRole("alert");
    await waitFor(() => expect(alert).toHaveTextContent(/couldn't save/i));
    expect(alert.textContent).not.toMatch(/\b503\b/);
    expect(fetchSpy).toHaveBeenCalled();
  });
});
