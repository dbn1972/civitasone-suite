import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithIntl as render } from "@/lib/testUtils/intl";

const pushMock = vi.fn();
let searchParamsMock = new URLSearchParams();

const suspendSearchParams = { on: false };
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
  useSearchParams: () => {
    if (suspendSearchParams.on) throw new Promise(() => {}); // never resolves -> Suspense fallback stays
    return searchParamsMock;
  },
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
function mockFetch(postStatus = 202, available = "999999999") {
  return vi.spyOn(globalThis, "fetch").mockImplementation(((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    if (method === "GET" && url.endsWith(`/${WORK}/awards`)) {
      return Promise.resolve(new Response(JSON.stringify({ data: [{ id: AWARD, agreementNumber: "AGR/42", contractorName: "Acme", status: "do_finalized" }] }), { status: 200 }));
    }
    if (method === "GET" && url.endsWith(`/mb/${MB}/measured-value`)) {
      return Promise.resolve(new Response(JSON.stringify({ data: { mbId: MB, measuredValueMinor: "1000000000", billedMinor: "1", availableMinor: available } }), { status: 200 }));
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
    expect(await screen.findByLabelText(/^Work/i)).toHaveValue(WORK);
    // award/mb become selects once the per-work lists load; the seeded value stays selected
    await waitFor(() => expect(screen.getByLabelText(/^Award/i)).toHaveValue(AWARD));
    await waitFor(() => expect(screen.getByLabelText(/Measurement Book/i)).toHaveValue(MB));
  });

  it("posts to the real create-bill endpoint with rupee amounts converted to paise (minor units)", async () => {
    const fetchSpy = mockFetch();
    render(<NewBillPage />);
    await screen.findByLabelText(/^Work/i);
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
    await screen.findByLabelText(/^Work/i);
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
    await screen.findByLabelText(/^Work/i);
    fireEvent.change(screen.getByLabelText(/Bill Number/i), { target: { value: "RA/3" } });
    fireEvent.change(screen.getByLabelText(/Gross Amount/i), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "Generate Bill" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/valid gross amount/i);
    expect(postCall(fetchSpy)).toBeUndefined();
  });

  it("blocks submission when deductions exceed the gross amount", async () => {
    const fetchSpy = mockFetch();
    render(<NewBillPage />);
    await screen.findByLabelText(/^Work/i);
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
    await screen.findByLabelText(/^Work/i);
    fireEvent.change(screen.getByLabelText(/Bill Number/i), { target: { value: "RA/2024-25/002" } });
    fireEvent.change(screen.getByLabelText(/Gross Amount/i), { target: { value: "1000" } });
    fireEvent.click(screen.getByRole("button", { name: "Generate Bill" }));

    const alert = await screen.findByRole("alert");
    await waitFor(() => expect(alert).toHaveTextContent(/couldn't save/i));
    expect(alert.textContent).not.toMatch(/\b503\b/);
    expect(fetchSpy).toHaveBeenCalled();
  });
});

describe("Suspense fallback (BILLS-NEW-04 / MEASUREMENTS-NEW-04 / NEW-MB-04)", () => {
  it("renders a skeleton, not an empty page, while useSearchParams() suspends", () => {
    suspendSearchParams.on = true;
    try {
      const { container } = render(<NewBillPage />);
      expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull();
      expect(screen.queryByRole("button", { name: /submit|generate bill|record measurement/i })).not.toBeInTheDocument();
    } finally {
      suspendSearchParams.on = false;
    }
  });
});

describe("Generate Bill form — single-option preselect (BILLS-NEW-01)", () => {
  it("preselects the only award and the only DO-finalized MB from the work's lists", async () => {
    vi.restoreAllMocks();
    searchParamsMock = new URLSearchParams(`workId=${WORK}`);
    mockFetch();
    render(<NewBillPage />);
    await waitFor(() => expect(screen.getByLabelText(/^Award/i)).toHaveValue(AWARD));
    await waitFor(() => expect(screen.getByLabelText(/Measurement Book/i)).toHaveValue(MB));
  });
});

describe("Generate Bill form - measured-value ceiling (GAP-WORKS-BILLING-BILLS-NEW-02)", () => {
  it("shows what is measured, already billed and still billable once the MB is chosen, and can prefill the gross", async () => {
    vi.restoreAllMocks();
    searchParamsMock = new URLSearchParams(`workId=${WORK}&awardId=${AWARD}&mbId=${MB}`);
    mockFetch(202, "60000");
    render(<NewBillPage />);
    const hint = await screen.findByTestId("mb-position");
    expect(hint).toHaveTextContent(/Still billable: .*600/);
    fireEvent.click(screen.getByRole("button", { name: /Use the full amount/i }));
    expect(screen.getByLabelText(/Gross Amount/i)).toHaveValue(600);
  });

  it("blocks a gross above the still-billable value before posting (server enforces the same ceiling)", async () => {
    vi.restoreAllMocks();
    searchParamsMock = new URLSearchParams(`workId=${WORK}&awardId=${AWARD}&mbId=${MB}`);
    const fetchSpy = mockFetch(202, "60000"); // 600 rupees available
    render(<NewBillPage />);
    await screen.findByTestId("mb-position");
    fireEvent.change(screen.getByLabelText(/Bill Number/i), { target: { value: "RA/1" } });
    fireEvent.change(screen.getByLabelText(/Gross Amount/i), { target: { value: "601" } });
    fireEvent.click(screen.getByRole("button", { name: /Generate Bill/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/more than the value still billable/i);
    expect(postCall(fetchSpy)).toBeUndefined();
  });
});

describe("Generate Bill form - e-MB gross starts from the MB's billable value (GAP-WORKS-BILLING-BILLS-NEW-02)", () => {
  const params = () => new URLSearchParams(`workId=${WORK}&awardId=${AWARD}&mbId=${MB}`);

  it("in e-MB mode the gross is prefilled with the value still billable against the chosen MB", async () => {
    vi.restoreAllMocks();
    searchParamsMock = params();
    mockFetch(202, "60000"); // 600.00 rupees still billable
    render(<NewBillPage />);
    await screen.findByTestId("mb-position");
    await waitFor(() => expect(screen.getByLabelText(/Gross Amount/i)).toHaveValue(600));
    // starting at the full billable value is not a "below" case
    expect(screen.queryByTestId("mb-below-available")).not.toBeInTheDocument();
  });

  it("does not overwrite a gross the clerk has already typed", async () => {
    vi.restoreAllMocks();
    searchParamsMock = params();
    mockFetch(202, "60000");
    render(<NewBillPage />);
    // type before the MB position arrives
    fireEvent.change(screen.getByLabelText(/Gross Amount/i), { target: { value: "250" } });
    await screen.findByTestId("mb-position");
    expect(screen.getByLabelText(/Gross Amount/i)).toHaveValue(250);
  });

  it("abstract mode does not prefill the gross (only e-MB bills start from the measurements)", async () => {
    vi.restoreAllMocks();
    searchParamsMock = params();
    mockFetch(202, "60000");
    render(<NewBillPage />);
    fireEvent.change(screen.getByLabelText(/Bill Mode/i), { target: { value: "abstract" } });
    await screen.findByTestId("mb-position");
    expect(screen.getByLabelText(/Gross Amount/i)).toHaveValue(null);
    // the ceiling hint is still shown: the server enforces the same measured-value ceiling in both modes
    expect(screen.getByTestId("mb-position")).toHaveTextContent(/Still billable: .*600/);
  });

  it("shows a neutral note, not an error, when an e-MB gross is below the billable value, and still posts it", async () => {
    vi.restoreAllMocks();
    searchParamsMock = params();
    const spy = mockFetch(202, "60000");
    render(<NewBillPage />);
    await screen.findByTestId("mb-position");
    fireEvent.change(screen.getByLabelText(/Bill Number/i), { target: { value: "RA/1" } });
    fireEvent.change(screen.getByLabelText(/Gross Amount/i), { target: { value: "400" } });
    const note = await screen.findByTestId("mb-below-available");
    expect(note).toHaveTextContent(/less than the value still billable.*600/);
    fireEvent.click(screen.getByRole("button", { name: /Generate Bill/i }));
    await waitFor(() => expect(postCall(spy)).toBeDefined());
    expect(JSON.parse((postCall(spy)![1] as RequestInit).body as string).grossAmountMinor).toBe("40000");
  });

  it("the note is not shown in abstract mode", async () => {
    vi.restoreAllMocks();
    searchParamsMock = params();
    mockFetch(202, "60000");
    render(<NewBillPage />);
    fireEvent.change(screen.getByLabelText(/Bill Mode/i), { target: { value: "abstract" } });
    await screen.findByTestId("mb-position");
    fireEvent.change(screen.getByLabelText(/Gross Amount/i), { target: { value: "400" } });
    expect(screen.queryByTestId("mb-below-available")).not.toBeInTheDocument();
  });
});

describe("Generate Bill form - duplicate bill number (GAP-WORKS-BILLING-BILLS-NEW-05)", () => {
  it("maps a 409 DUPLICATE_BILL_NUMBER to a field message under Bill Number, keeping the form data", async () => {
    vi.restoreAllMocks();
    searchParamsMock = new URLSearchParams(`workId=${WORK}&awardId=${AWARD}&mbId=${MB}`);
    vi.spyOn(globalThis, "fetch").mockImplementation(((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if ((init?.method ?? "GET").toUpperCase() === "POST") {
        return Promise.resolve(new Response(JSON.stringify({ code: "DUPLICATE_BILL_NUMBER", message: "Bill number already used for this work" }), { status: 409 }));
      }
      if (url.endsWith(`/mb/${MB}/measured-value`)) {
        return Promise.resolve(new Response(JSON.stringify({ data: { mbId: MB, measuredValueMinor: "100000", billedMinor: "0", availableMinor: "100000" } }), { status: 200 }));
      }
      return Promise.resolve(new Response(JSON.stringify({ data: [] }), { status: 200 }));
    }) as typeof fetch);
    render(<NewBillPage />);
    await screen.findByTestId("mb-position");
    fireEvent.change(screen.getByLabelText(/Bill Number/i), { target: { value: "RA/1" } });
    fireEvent.click(screen.getByRole("button", { name: /Generate Bill/i }));
    const alert = await screen.findByText("This bill number is already used for this work. Choose a different number.");
    expect(alert).toHaveAttribute("role", "alert");
    expect(screen.getByLabelText(/Bill Number/i)).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText(/Bill Number/i)).toHaveValue("RA/1");
    // editing the number clears the message
    fireEvent.change(screen.getByLabelText(/Bill Number/i), { target: { value: "RA/2" } });
    expect(screen.queryByText(/already used for this work/)).not.toBeInTheDocument();
  });
});
