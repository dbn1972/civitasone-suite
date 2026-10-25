import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithIntl as render } from "@/lib/testUtils/intl";

const pushMock = vi.fn();
let searchParamsMock = new URLSearchParams();
const suspendSearchParams = { on: false };

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
  useSearchParams: () => {
    if (suspendSearchParams.on) throw new Promise(() => {}); // never resolves -> the Suspense fallback stays up
    return searchParamsMock;
  },
}));

vi.mock("@/app/_components/ds/Toast", () => ({
  useToast: () => ({
    toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
  }),
}));

// Work picker adapter — resolve the preset id to a label so the picker shows it.
vi.mock("@/lib/entityAdapters/workProposal", () => ({
  searchWorkProposals: vi.fn(async () => [{ id: "11111111-1111-1111-1111-111111111111", label: "WRK-1", sublabel: "Road" }]),
  resolveWorkProposals: vi.fn(async () => [{ id: "11111111-1111-1111-1111-111111111111", label: "WRK-1", sublabel: "Road" }]),
}));

// SR search adapter.
vi.mock("../../_data/client", () => ({
  searchSrItems: vi.fn(async () => [{ id: "sr-1", itemCode: "PCC-1-4-8", description: "PCC 1:4:8", unit: "cum", rate: "45000" }]),
}));

import NewBoqItemPage from "./page";

const WORK = "11111111-1111-1111-1111-111111111111";

describe("Add BoQ Item form", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    pushMock.mockReset();
    searchParamsMock = new URLSearchParams();
  });

  function fillRequired() {
    fireEvent.change(screen.getByLabelText(/Item description/i), { target: { value: "PCC 1:4:8" } });
    fireEvent.change(screen.getByLabelText(/^Unit/i), { target: { value: "cum" } });
    fireEvent.change(screen.getByLabelText(/Quantity/i), { target: { value: "3" } });
  }

  it("GAP-WORKS-BOQ-NEW-02: formats the live estimate as grouped rupees (₹…), not a bare float", async () => {
    searchParamsMock = new URLSearchParams(`workId=${WORK}`);
    render(<NewBoqItemPage />);
    fireEvent.change(screen.getByLabelText(/Rate per unit/i), { target: { value: "125" } });
    fireEvent.change(screen.getByLabelText(/Quantity/i), { target: { value: "1000" } });
    // ₹125 × 1000 = ₹1,25,000.00 (Indian grouping), never "125000.00"
    await waitFor(() => expect(screen.getByText(/Estimated: ₹1,25,000\.00/)).toBeInTheDocument());
  });

  it("GAP-WORKS-BOQ-NEW-01/02: rejects a sub-paise rate like 1.005 before posting", async () => {
    searchParamsMock = new URLSearchParams(`workId=${WORK}`);
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    render(<NewBoqItemPage />);
    fillRequired();
    fireEvent.change(screen.getByLabelText(/Rate per unit/i), { target: { value: "1.005" } });
    fireEvent.click(screen.getByRole("button", { name: "Add BoQ Item" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/valid rate/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("GAP-WORKS-BOQ-NEW-04: rejects a zero rate before posting (the API refuses it too)", async () => {
    searchParamsMock = new URLSearchParams(`workId=${WORK}`);
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    render(<NewBoqItemPage />);
    fillRequired();
    fireEvent.change(screen.getByLabelText(/Rate per unit/i), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "Add BoQ Item" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/greater than zero/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("GAP-WORKS-BOQ-NEW-01: converts rupee rate to paise and posts it (bigint money rule)", async () => {
    searchParamsMock = new URLSearchParams(`workId=${WORK}`);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "boq-1" }), { status: 202 }),
    );
    render(<NewBoqItemPage />);
    fillRequired();
    fireEvent.change(screen.getByLabelText(/Rate per unit/i), { target: { value: "12.50" } });
    fireEvent.click(screen.getByRole("button", { name: "Add BoQ Item" }));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("/api/proxy/v1/works/boq");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.rate).toBe("1250"); // ₹12.50 → 1250 paise
    expect(body.workId).toBe(WORK);
    // GAP-WORKS-BOQ-NEW-04: quantity travels as the typed decimal string, never a JS float.
    expect(typeof body.quantity).toBe("string");
  });

  // works-service answers a duplicate line with 409 and the flat envelope { code: "DUPLICATE_BOQ_LINE", ... }.
  const duplicateResponse = () =>
    new Response(JSON.stringify({ code: "DUPLICATE_BOQ_LINE", message: "x", correlationId: "c", retryable: false }), {
      status: 409, headers: { "content-type": "application/json" },
    });

  it("GAP-WORKS-BOQ-NEW-04: a duplicate item code is an inline error ON the item code field, form data kept", async () => {
    searchParamsMock = new URLSearchParams(`workId=${WORK}`);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(duplicateResponse());
    render(<NewBoqItemPage />);
    fillRequired();
    fireEvent.change(screen.getByLabelText(/Item code/i), { target: { value: "SR-1" } });
    fireEvent.change(screen.getByLabelText(/Rate per unit/i), { target: { value: "12.50" } });
    fireEvent.click(screen.getByRole("button", { name: "Add BoQ Item" }));

    const codeError = await screen.findByText(/item code is already on the BoQ/i);
    expect(codeError).toHaveAttribute("role", "alert");
    expect(codeError).toHaveAttribute("id", "itemCode-error");
    const code = screen.getByLabelText(/Item code/i);
    expect(code).toHaveAttribute("aria-invalid", "true");
    expect(code).toHaveAttribute("aria-describedby", "itemCode-error");
    // Not a page-level banner, no raw status, nothing cleared, no redirect.
    expect(document.body.textContent).not.toMatch(/\b409\b/);
    expect(code).toHaveValue("SR-1");
    expect(screen.getByLabelText(/Item description/i)).toHaveValue("PCC 1:4:8");
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("GAP-WORKS-BOQ-NEW-04: with no item code the duplicate is flagged on the description field", async () => {
    searchParamsMock = new URLSearchParams(`workId=${WORK}`);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(duplicateResponse());
    render(<NewBoqItemPage />);
    fillRequired();
    fireEvent.change(screen.getByLabelText(/Rate per unit/i), { target: { value: "12.50" } });
    fireEvent.click(screen.getByRole("button", { name: "Add BoQ Item" }));
    const descError = await screen.findByText(/line with this description is already on the BoQ/i);
    expect(descError).toHaveAttribute("id", "itemDescription-error");
    expect(screen.getByLabelText(/Item description/i)).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText(/Item code/i)).not.toHaveAttribute("aria-invalid");
  });

  it("GAP-WORKS-BOQ-NEW-04: editing the flagged field clears its inline error", async () => {
    searchParamsMock = new URLSearchParams(`workId=${WORK}`);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(duplicateResponse());
    render(<NewBoqItemPage />);
    fillRequired();
    fireEvent.change(screen.getByLabelText(/Item code/i), { target: { value: "SR-1" } });
    fireEvent.change(screen.getByLabelText(/Rate per unit/i), { target: { value: "12.50" } });
    fireEvent.click(screen.getByRole("button", { name: "Add BoQ Item" }));
    await screen.findByText(/item code is already on the BoQ/i);
    fireEvent.change(screen.getByLabelText(/Item code/i), { target: { value: "SR-2" } });
    expect(screen.queryByText(/item code is already on the BoQ/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/Item code/i)).not.toHaveAttribute("aria-invalid");
  });

  it("GAP-WORKS-BOQ-NEW-04: another 409 (BoQ frozen after tender) is the catalogued page message, not a field error", async () => {
    searchParamsMock = new URLSearchParams(`workId=${WORK}`);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ code: "BOQ_FROZEN", message: "x", correlationId: "c", retryable: false }), {
        status: 409, headers: { "content-type": "application/json" },
      }),
    );
    render(<NewBoqItemPage />);
    fillRequired();
    fireEvent.change(screen.getByLabelText(/Rate per unit/i), { target: { value: "12.50" } });
    fireEvent.click(screen.getByRole("button", { name: "Add BoQ Item" }));
    const alert = await screen.findByRole("alert");
    await waitFor(() => expect(alert).toHaveTextContent(/can't be changed any more/i));
    expect(screen.getByLabelText(/Item code/i)).not.toHaveAttribute("aria-invalid");
  });

  it("GAP-WORKS-BOQ-NEW-04: the early check against the work's BoQ list flags a duplicate on blur, before any POST", async () => {
    searchParamsMock = new URLSearchParams(`workId=${WORK}`);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((async (input: RequestInfo | URL) => {
      if (String(input).endsWith(`/v1/works/boq/${WORK}`)) {
        return new Response(JSON.stringify({ data: [{ itemCode: "sr-1", itemDescription: "Anything" }] }), { status: 200 });
      }
      return new Response("{}", { status: 202 });
    }) as typeof fetch);
    render(<NewBoqItemPage />);
    const code = screen.getByLabelText(/Item code/i);
    fireEvent.change(code, { target: { value: " SR-1 " } });
    fireEvent.blur(code);
    expect(await screen.findByText(/item code is already on the BoQ/i)).toBeInTheDocument();
    expect(fetchSpy.mock.calls.some((c) => (c[1] as RequestInit | undefined)?.method === "POST")).toBe(false);
  });

  it("GAP-WORKS-BOQ-NEW-04: a new code that is not on the list gets no early error", async () => {
    searchParamsMock = new URLSearchParams(`workId=${WORK}`);
    vi.spyOn(globalThis, "fetch").mockImplementation((async () =>
      new Response(JSON.stringify({ data: [{ itemCode: "SR-1", itemDescription: "Anything" }] }), { status: 200 })) as typeof fetch);
    render(<NewBoqItemPage />);
    const code = screen.getByLabelText(/Item code/i);
    fireEvent.change(code, { target: { value: "SR-9" } });
    fireEvent.blur(code);
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    expect(screen.queryByText(/already on the BoQ/i)).not.toBeInTheDocument();
  });

  it("shows a clerk-safe message, never the raw HTTP status, when the create fails (UX-016)", async () => {
    searchParamsMock = new URLSearchParams(`workId=${WORK}`);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 500 }));
    render(<NewBoqItemPage />);
    fillRequired();
    fireEvent.change(screen.getByLabelText(/Rate per unit/i), { target: { value: "12.50" } });
    fireEvent.click(screen.getByRole("button", { name: "Add BoQ Item" }));
    const alert = await screen.findByRole("alert");
    await waitFor(() => expect(alert).toHaveTextContent(/couldn't save/i));
    expect(alert.textContent).not.toMatch(/\b500\b/);
  });
});

describe("Add BoQ Item form - re-check of BOQ-NEW-01 / NEW-03 (work + SR lookup)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    pushMock.mockReset();
    searchParamsMock = new URLSearchParams();
  });

  it("GAP-WORKS-BOQ-NEW-03: without ?workId= the work is chosen by number from a search, and its id (never typed) is posted", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 202 }));
    render(<NewBoqItemPage />);
    const workBox = screen.getByRole("combobox", { name: "Work" });
    expect(workBox).not.toBeDisabled();
    fireEvent.focus(workBox);
    fireEvent.change(workBox, { target: { value: "WRK" } });
    fireEvent.mouseDown(await screen.findByText("WRK-1"));
    fireEvent.change(screen.getByLabelText(/Item description/i), { target: { value: "PCC" } });
    fireEvent.change(screen.getByLabelText(/^Unit/i), { target: { value: "cum" } });
    fireEvent.change(screen.getByLabelText(/Quantity/i), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText(/Rate per unit/i), { target: { value: "10" } });
    fireEvent.click(screen.getByRole("button", { name: "Add BoQ Item" }));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    expect(JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string).workId).toBe(WORK);
  });

  it("GAP-WORKS-BOQ-NEW-01: choosing a Schedule-of-Rates item fills unit and rate and posts its srItemId", async () => {
    searchParamsMock = new URLSearchParams(`workId=${WORK}`);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 202 }));
    render(<NewBoqItemPage />);
    const sr = screen.getByRole("combobox", { name: "Schedule of Rates item" });
    fireEvent.focus(sr);
    fireEvent.change(sr, { target: { value: "PCC" } });
    fireEvent.mouseDown(await screen.findByText(/PCC-1-4-8/));
    await waitFor(() => expect(screen.getByLabelText(/^Unit/i)).toHaveValue("cum"));
    expect(screen.getByLabelText(/Rate per unit/i)).toHaveValue("450.00");
    fireEvent.change(screen.getByLabelText(/Quantity/i), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Add BoQ Item" }));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const body = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.srItemId).toBe("sr-1");
    expect(body.rate).toBe("45000");
  });
});

// GAP-WORKS-BOQ-NEW-04: while useSearchParams() suspends, the boundary shows the SkeletonCard, not a blank frame.
describe("Add BoQ Item form - Suspense fallback", () => {
  it("renders the skeleton (and no form) while the search params are still resolving", () => {
    suspendSearchParams.on = true;
    try {
      const { container } = render(<NewBoqItemPage />);
      expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull();
      expect(screen.queryByRole("button", { name: "Add BoQ Item" })).not.toBeInTheDocument();
      expect(screen.queryByLabelText(/Item description/i)).not.toBeInTheDocument();
    } finally {
      suspendSearchParams.on = false;
    }
  });
});

describe("Add BoQ Item duplicate-submit latch (CLOS3-S3-18)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    pushMock.mockReset();
    searchParamsMock = new URLSearchParams(`workId=${WORK}`);
  });

  function fillValid() {
    fireEvent.change(screen.getByLabelText(/Item description/i), { target: { value: "PCC 1:4:8" } });
    fireEvent.change(screen.getByLabelText(/^Unit/i), { target: { value: "cum" } });
    fireEvent.change(screen.getByLabelText(/Quantity/i), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText(/Rate per unit/i), { target: { value: "12.50" } });
  }
  const posts = (spy: { mock: { calls: unknown[][] } }) =>
    spy.mock.calls.filter((c) => (c[1] as RequestInit | undefined)?.method === "POST");

  it("a second submit while the redirect is pending does not create a duplicate BoQ item", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify({ id: "boq-1" }), { status: 202 }));
    render(<NewBoqItemPage />);
    fillValid();
    const btn = screen.getByRole("button", { name: "Add BoQ Item" });
    const form = btn.closest("form") as HTMLFormElement;
    fireEvent.click(btn);
    await screen.findByText("BoQ item added.");
    expect(screen.getByRole("button", { name: /Saving|Add BoQ Item/ })).toBeDisabled();
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(posts(spy)).toHaveLength(1);
    await waitFor(() => expect(pushMock).toHaveBeenCalledTimes(1), { timeout: 2000 });
    expect(posts(spy)).toHaveLength(1);
  });

  it("a failed save does not latch: a resubmit POSTs again", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("", { status: 500 }));
    render(<NewBoqItemPage />);
    fillValid();
    fireEvent.click(screen.getByRole("button", { name: "Add BoQ Item" }));
    await screen.findByRole("alert");
    await waitFor(() => expect(screen.getByRole("button", { name: "Add BoQ Item" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Add BoQ Item" }));
    await waitFor(() => expect(posts(spy)).toHaveLength(2));
  });
});
