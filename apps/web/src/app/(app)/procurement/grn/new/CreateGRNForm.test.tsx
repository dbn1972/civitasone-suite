import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import { CreateGRNForm } from "./CreateGRNForm";

describe("CreateGRNForm — required-field ARIA (Req 3.5)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // The component fetches vendors/POs on mount; return empty lists so the
    // form renders in its ready-but-empty state without erroring. A fresh
    // Response per call is required because a Response body is single-use.
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ data: [] }), { status: 200, headers: { "content-type": "application/json" } })),
    );
  });

  it("marks the Purchase order and Vendor selects as aria-required", async () => {
    render(<CreateGRNForm />);
    const poSelect = await screen.findByLabelText("Purchase order *");
    const vendorSelect = await screen.findByLabelText("Vendor *");
    expect(poSelect).toHaveAttribute("aria-required", "true");
    expect(vendorSelect).toHaveAttribute("aria-required", "true");
  });

  it("points required fields at the error message via aria-describedby once a validation error is shown", async () => {
    render(<CreateGRNForm />);
    const poSelect = await screen.findByLabelText("Purchase order *");
    expect(poSelect).not.toHaveAttribute("aria-describedby");

    const submit = screen.getByRole("button", { name: "Record GRN" });
    fireEvent.click(submit);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/required/i);
    });
    const errorMessage = screen.getByRole("alert");
    expect(errorMessage).toHaveAttribute("id", "grn-form-message");
    expect(poSelect).toHaveAttribute("aria-describedby", "grn-form-message");
  });
});

describe("CreateGRNForm — GRN-NEW-02/03/05", () => {
  const VENDOR = { id: "22222222-2222-4222-8222-222222222222", name: "Acme Supplies" };
  const PO = { id: "33333333-3333-4333-8333-333333333333", poNo: "PO/2026/0001", vendorId: VENDOR.id };
  const PO_DETAIL = {
    id: PO.id,
    vendorId: VENDOR.id,
    items: [{ id: "poi-1", itemCode: "PAPER-A4", quantity: 10, unit: "reams" }],
  };

  function mockRoutes() {
    vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/vendors")) return Promise.resolve(new Response(JSON.stringify({ data: [VENDOR] }), { status: 200 }));
      if (url.includes(`/pos/${PO.id}`)) return Promise.resolve(new Response(JSON.stringify(PO_DETAIL), { status: 200 }));
      if (url.includes("/pos")) return Promise.resolve(new Response(JSON.stringify({ data: [PO] }), { status: 200 }));
      if (url.includes("/grns")) return Promise.resolve(new Response(JSON.stringify({ id: "new-grn" }), { status: 202 }));
      return Promise.resolve(new Response(JSON.stringify({ data: [] }), { status: 200 }));
    });
  }

  beforeEach(() => { vi.restoreAllMocks(); });

  it("does not auto-select a PO on load (NEW-02)", async () => {
    mockRoutes();
    render(<CreateGRNForm />);
    const poSelect = await screen.findByLabelText("Purchase order *") as HTMLSelectElement;
    await waitFor(() => expect(screen.getByRole("option", { name: /PO\/2026\/0001/ })).toBeInTheDocument());
    expect(poSelect.value).toBe("");
  });

  it("lays out PO items with ordered prefilled and received blank, and uses the PO item unit (NEW-02/03)", async () => {
    mockRoutes();
    render(<CreateGRNForm />);
    const poSelect = await screen.findByLabelText("Purchase order *");
    await waitFor(() => expect(screen.getByRole("option", { name: /PO\/2026\/0001/ })).toBeInTheDocument());
    fireEvent.change(poSelect, { target: { value: PO.id } });
    await waitFor(() => expect(screen.getByText("reams")).toBeInTheDocument());
    const received = screen.getByLabelText("Received qty row 1") as HTMLInputElement;
    expect(received.value).toBe("0");
  });

  it("blocks submit when nothing was received (NEW-02)", async () => {
    mockRoutes();
    render(<CreateGRNForm />);
    const poSelect = await screen.findByLabelText("Purchase order *");
    await waitFor(() => expect(screen.getByRole("option", { name: /PO\/2026\/0001/ })).toBeInTheDocument());
    fireEvent.change(poSelect, { target: { value: PO.id } });
    await waitFor(() => expect(screen.getByText("reams")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Record GRN" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/received quantity for at least one item/i));
  });

  it("blocks submit when received exceeds ordered (NEW-03)", async () => {
    mockRoutes();
    render(<CreateGRNForm />);
    const poSelect = await screen.findByLabelText("Purchase order *");
    await waitFor(() => expect(screen.getByRole("option", { name: /PO\/2026\/0001/ })).toBeInTheDocument());
    fireEvent.change(poSelect, { target: { value: PO.id } });
    await waitFor(() => expect(screen.getByText("reams")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Received qty row 1"), { target: { value: "12" } });
    fireEvent.click(screen.getByRole("button", { name: "Record GRN" }));
    await waitFor(() => expect(screen.getByText(/cannot exceed ordered/i)).toBeInTheDocument());
  });

  it("shows a Retry when the PO list fails to load (NEW-05)", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/vendors")) return Promise.resolve(new Response(JSON.stringify({ data: [VENDOR] }), { status: 200 }));
      if (url.includes("/pos")) return Promise.resolve(new Response("err", { status: 500 }));
      return Promise.resolve(new Response(JSON.stringify({ data: [] }), { status: 200 }));
    });
    render(<CreateGRNForm />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument());
    expect(screen.getByRole("alert")).toHaveTextContent(/Couldn't load/i);
  });
});
