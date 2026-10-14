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

  it("GAP-WORKS-BOQ-NEW-04: maps a 409 duplicate to a clear field message, not the raw status", async () => {
    searchParamsMock = new URLSearchParams(`workId=${WORK}`);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 409 }));
    render(<NewBoqItemPage />);
    fillRequired();
    fireEvent.change(screen.getByLabelText(/Rate per unit/i), { target: { value: "12.50" } });
    fireEvent.click(screen.getByRole("button", { name: "Add BoQ Item" }));
    const alert = await screen.findByRole("alert");
    await waitFor(() => expect(alert).toHaveTextContent(/already exists for this work/i));
    expect(alert.textContent).not.toMatch(/\b409\b/);
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
