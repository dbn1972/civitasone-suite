/**
 * Owner decision D4c #37: the bill form shows the five fixed statutory deduction heads, pre-filled from the server's
 * computed preview (division rates), editable by the maker, summing to the bill's total deductions.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithIntl as render } from "@/lib/testUtils/intl";

const pushMock = vi.fn();
let searchParamsMock = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
  useSearchParams: () => searchParamsMock,
}));
vi.mock("@/app/_components/ds/Toast", () => ({
  useToast: () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }),
}));

import NewBillPage from "./page";

const WORK = "11111111-1111-1111-1111-111111111111";
const AWARD = "22222222-2222-2222-2222-222222222222";
const MB = "33333333-3333-3333-3333-333333333333";

const PREVIEW = {
  lines: [
    { head: "security_deposit", rateBps: 500, amountMinor: "5000" },
    { head: "income_tax_tds", rateBps: 200, amountMinor: "2000" },
    { head: "gst_tds", rateBps: 200, amountMinor: "2000" },
    { head: "labour_cess", rateBps: 100, amountMinor: "1000" },
    { head: "retention", rateBps: 0, amountMinor: "0" },
  ],
  totalMinor: "10000",
};

function mockFetch(opts: { preview?: boolean } = {}) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    if (method === "GET" && url.includes("/deduction-preview")) {
      return Promise.resolve(opts.preview === false
        ? new Response("{}", { status: 503 })
        : new Response(JSON.stringify({ data: PREVIEW }), { status: 200 }));
    }
    if (method === "GET" && url.endsWith(`/${WORK}/awards`)) {
      return Promise.resolve(new Response(JSON.stringify({ data: [{ id: AWARD, agreementNumber: "AGR/42", contractorName: "Acme" }] }), { status: 200 }));
    }
    if (method === "GET" && url.endsWith(`/${WORK}/mbs`)) {
      return Promise.resolve(new Response(JSON.stringify({ data: [{ id: MB, mbNumber: "MB/01", status: "do_finalized" }] }), { status: 200 }));
    }
    if (method === "GET") return Promise.resolve(new Response(JSON.stringify({ data: {} }), { status: 200 }));
    return Promise.resolve(new Response(JSON.stringify({ data: { id: "bill-1" } }), { status: 202 }));
  }) as typeof fetch);
}
const postCall = (spy: ReturnType<typeof mockFetch>) => spy.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === "POST");

async function fillBasics() {
  await screen.findByLabelText(/^Work/i);
  await waitFor(() => expect(screen.getByLabelText(/^Award/i)).toHaveValue(AWARD));
  fireEvent.change(screen.getByLabelText(/Bill Number/i), { target: { value: "RA/1" } });
  fireEvent.change(screen.getByLabelText(/Gross Amount/i), { target: { value: "100" } }); // 10000 paise
}

describe("Generate Bill form: statutory deductions (D4c #37)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    pushMock.mockReset();
    searchParamsMock = new URLSearchParams(`workId=${WORK}&awardId=${AWARD}&mbId=${MB}`);
  });

  it("asks the server to compute the heads for the work and gross, and pre-fills the five fixed lines", async () => {
    const spy = mockFetch();
    render(<NewBillPage />);
    await fillBasics();
    const sd = await screen.findByLabelText(/Security deposit/i);
    expect(sd).toHaveValue(50);
    expect(screen.getByLabelText(/Income-tax TDS/i)).toHaveValue(20);
    expect(screen.getByLabelText(/GST TDS/i)).toHaveValue(20);
    expect(screen.getByLabelText(/Labour cess/i)).toHaveValue(10);
    expect(screen.getByLabelText(/Retention/i)).toHaveValue(0);
    const previewCall = spy.mock.calls.find((c) => String(c[0]).includes("/deduction-preview"))!;
    expect(String(previewCall[0])).toContain(`workId=${WORK}`);
    expect(String(previewCall[0])).toContain("grossAmountMinor=10000");
    // total deductions is the sum of the lines and is not typed separately
    expect(screen.getByLabelText(/^Deductions/i)).toHaveValue(100);
    expect(screen.getByLabelText(/^Deductions/i)).toHaveAttribute("readonly");
  });

  it("lets the maker adjust a line: the total and net payable follow, and the post carries every head in paise", async () => {
    const spy = mockFetch();
    render(<NewBillPage />);
    await fillBasics();
    const tds = await screen.findByLabelText(/Income-tax TDS/i);
    fireEvent.change(tds, { target: { value: "10" } });
    expect(screen.getByLabelText(/^Deductions/i)).toHaveValue(90);
    expect(screen.getByText(/adjusted from the computed/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Generate Bill" }));
    await waitFor(() => expect(postCall(spy)).toBeTruthy());
    const body = JSON.parse((postCall(spy)![1] as RequestInit).body as string);
    expect(body.deductionsMinor).toBeUndefined();
    expect(body.recoveries).toEqual([
      { recoveryType: "security_deposit", amountMinor: "5000" },
      { recoveryType: "income_tax_tds", amountMinor: "1000" },
      { recoveryType: "gst_tds", amountMinor: "2000" },
      { recoveryType: "labour_cess", amountMinor: "1000" },
      { recoveryType: "retention", amountMinor: "0" },
    ]);
  });

  it("blocks the post when the lines add up to more than the gross", async () => {
    const spy = mockFetch();
    render(<NewBillPage />);
    await fillBasics();
    fireEvent.change(await screen.findByLabelText(/Retention/i), { target: { value: "500" } });
    fireEvent.click(screen.getByRole("button", { name: "Generate Bill" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/cannot exceed/i);
    expect(postCall(spy)).toBeUndefined();
  });

  it("blocks the post on an invalid line amount", async () => {
    const spy = mockFetch();
    render(<NewBillPage />);
    await fillBasics();
    fireEvent.change(await screen.findByLabelText(/GST TDS/i), { target: { value: "1.234" } });
    // the browser would stop a sub-paisa step in native validation; submit directly to prove the handler refuses it too
    fireEvent.submit(screen.getByRole("button", { name: "Generate Bill" }).closest("form")!);
    expect(await screen.findByRole("alert")).toHaveTextContent(/GST TDS/);
    expect(postCall(spy)).toBeUndefined();
  });

  it("falls back to the single deductions field when the preview cannot be loaded", async () => {
    mockFetch({ preview: false });
    render(<NewBillPage />);
    await fillBasics();
    await waitFor(() => expect(screen.getByLabelText(/^Deductions/i)).not.toHaveAttribute("readonly"));
    expect(screen.queryByLabelText(/Security deposit/i)).toBeNull();
  });
});
