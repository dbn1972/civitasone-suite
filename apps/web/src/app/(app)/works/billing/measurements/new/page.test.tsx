import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

let searchParamsMock = new URLSearchParams();
const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
  useSearchParams: () => searchParamsMock,
}));

vi.mock("@/app/_components/ds/Toast", () => ({
  useToast: () => ({
    toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
  }),
}));

import RecordMeasurementPage from "./page";

const MB = "123e4567-e89b-12d3-a456-426614174000";
const BOQ = "223e4567-e89b-12d3-a456-426614174999";

function setMb(value: string) {
  // No workId param ⇒ MB field is a text input labelled "Measurement Book *".
  fireEvent.change(screen.getByLabelText(/Measurement Book/i), { target: { value } });
}

function postCall(spy: { mock: { calls: unknown[][] } }) {
  return (spy.mock.calls as [RequestInfo, RequestInit?][]).find((c) => (c[1]?.method ?? "GET") === "POST");
}

describe("RecordMeasurementPage — computed quantity (MEASUREMENTS-NEW-01)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    searchParamsMock = new URLSearchParams();
    pushMock.mockReset();
  });

  it("computes No. × L × B × D and offers it as a suggestion", () => {
    render(<RecordMeasurementPage />);
    fireEvent.change(screen.getByLabelText(/^Length/i), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText(/^Breadth/i), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText(/^Depth/i), { target: { value: "0.5" } });
    fireEvent.change(screen.getByLabelText(/^No\./i), { target: { value: "2" } });
    expect(screen.getByText(/Computed from dimensions:/)).toHaveTextContent("6.000");
  });

  it("blocks a quantity that differs from the computed value until a remark is given", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ data: {} }), { status: 202 }));
    render(<RecordMeasurementPage />);
    setMb(MB);
    fireEvent.change(screen.getByLabelText(/BoQ Item ID/i), { target: { value: BOQ } });
    fireEvent.change(screen.getByLabelText(/^Length/i), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText(/^Breadth/i), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText(/^Quantity/i), { target: { value: "9" } }); // computed = 6
    fireEvent.click(screen.getByRole("button", { name: "Record Measurement" }));

    expect(screen.getByRole("alert")).toHaveTextContent(/differs from the computed value/i);
    expect(postCall(spy)).toBeUndefined();

    // With a remark, the same submit now posts.
    fireEvent.change(screen.getByLabelText(/Remarks/i), { target: { value: "extra lift accounted separately" } });
    fireEvent.click(screen.getByRole("button", { name: "Record Measurement" }));
    await waitFor(() => expect(postCall(spy)).toBeTruthy());
  });

  it("'Use computed' fills Quantity with the computed value", () => {
    render(<RecordMeasurementPage />);
    fireEvent.change(screen.getByLabelText(/^Length/i), { target: { value: "4" } });
    fireEvent.change(screen.getByLabelText(/^Breadth/i), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Use computed" }));
    expect(screen.getByLabelText(/^Quantity/i)).toHaveValue(8);
  });
});

describe("RecordMeasurementPage — validation (MEASUREMENTS-NEW-03/04)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    searchParamsMock = new URLSearchParams();
    pushMock.mockReset();
  });

  it("rejects a non-positive quantity without posting", () => {
    const spy = vi.spyOn(globalThis, "fetch");
    render(<RecordMeasurementPage />);
    setMb(MB);
    fireEvent.change(screen.getByLabelText(/BoQ Item ID/i), { target: { value: BOQ } });
    fireEvent.change(screen.getByLabelText(/^Quantity/i), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "Record Measurement" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/positive number/i);
    expect(spy).not.toHaveBeenCalled();
  });

  it("sends the quantity as an exact JSON number (no float coercion surprises)", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ data: {} }), { status: 202 }));
    render(<RecordMeasurementPage />);
    setMb(MB);
    fireEvent.change(screen.getByLabelText(/BoQ Item ID/i), { target: { value: BOQ } });
    fireEvent.change(screen.getByLabelText(/^Quantity/i), { target: { value: "12.345" } });
    fireEvent.click(screen.getByRole("button", { name: "Record Measurement" }));
    await waitFor(() => expect(postCall(spy)).toBeTruthy());
    const body = JSON.parse((postCall(spy)![1] as RequestInit).body as string);
    expect(body.quantity).toBe(12.345);
  });
});

describe("RecordMeasurementPage — UX-016 clerk-safe errors", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    searchParamsMock = new URLSearchParams();
    pushMock.mockReset();
  });

  it("shows a clerk-safe message, never the raw HTTP status, when recording a measurement fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 500 }));

    render(<RecordMeasurementPage />);
    setMb(MB);
    fireEvent.change(screen.getByLabelText(/BoQ Item ID/i), { target: { value: BOQ } });
    fireEvent.change(screen.getByLabelText(/^Quantity/i), { target: { value: "12.5" } });
    fireEvent.click(screen.getByRole("button", { name: "Record Measurement" }));

    const alert = await screen.findByRole("alert");
    await waitFor(() => expect(alert).toHaveTextContent(/couldn't save/i));
    expect(alert.textContent).not.toMatch(/\b500\b/);
  });
});
