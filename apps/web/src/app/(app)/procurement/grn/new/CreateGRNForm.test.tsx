import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@/test-utils/intl-render";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import { CreateGRNForm } from "./CreateGRNForm";

const VENDOR = { id: "22222222-2222-4222-8222-222222222222", name: "Acme Supplies" };
const PO = { id: "33333333-3333-4333-8333-333333333333", poNo: "PO/2026/0001", vendor: VENDOR.name, vendorId: VENDOR.id };
const FAR_PO = { id: "44444444-4444-4444-8444-444444444444", poNo: "PO/2026/0777", vendor: "Far Away Ltd", vendorId: "55555555-5555-4555-8555-555555555555" };
const PO_DETAIL = {
  id: PO.id,
  vendorId: VENDOR.id,
  items: [{ id: "poi-1", itemCode: "PAPER-A4", quantity: 10, unit: "reams" }],
};

function mockRoutes(urls: string[] = []) {
  vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);
    if (url.includes(`/pos/${PO.id}`)) return Promise.resolve(new Response(JSON.stringify(PO_DETAIL), { status: 200 }));
    if (url.includes(`/pos/${FAR_PO.id}`)) return Promise.resolve(new Response(JSON.stringify({ id: FAR_PO.id, vendorId: FAR_PO.vendorId, items: [] }), { status: 200 }));
    if (url.includes("/pos") && url.includes("q=0777")) return Promise.resolve(new Response(JSON.stringify({ data: [FAR_PO] }), { status: 200 }));
    if (url.includes("/pos")) return Promise.resolve(new Response(JSON.stringify({ data: [PO] }), { status: 200 }));
    if (url.includes("/grns")) return Promise.resolve(new Response(JSON.stringify({ id: "new-grn" }), { status: 202 }));
    return Promise.resolve(new Response(JSON.stringify({ data: [] }), { status: 200 }));
  });
}

/** Open the PO combobox and choose an option by its PO number. */
async function pickPo(poNo: string | RegExp) {
  const box = await screen.findByLabelText("Purchase order *");
  fireEvent.focus(box);
  fireEvent.mouseDown(await screen.findByRole("option", { name: poNo }));
}

describe("CreateGRNForm - required-field ARIA (Req 3.5)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockRoutes();
  });

  it("marks the Purchase order combobox as aria-required", async () => {
    render(<CreateGRNForm />);
    const po = await screen.findByLabelText("Purchase order *");
    expect(po).toHaveAttribute("role", "combobox");
    expect(po).toHaveAttribute("aria-required", "true");
  });

  it("points the PO field at the error message via aria-describedby once a validation error is shown", async () => {
    render(<CreateGRNForm />);
    const po = await screen.findByLabelText("Purchase order *");
    expect(po).not.toHaveAttribute("aria-describedby");

    fireEvent.click(screen.getByRole("button", { name: "Record GRN" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/required/i);
    });
    const errorMessage = screen.getByRole("alert");
    expect(errorMessage).toHaveAttribute("id", "grn-form-message");
    expect(po).toHaveAttribute("aria-describedby", "grn-form-message");
  });
});

describe("CreateGRNForm - GRN-NEW-02/03/04/05", () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it("does not auto-select a PO on load (NEW-02)", async () => {
    mockRoutes();
    render(<CreateGRNForm />);
    const po = await screen.findByLabelText("Purchase order *") as HTMLInputElement;
    expect(po.value).toBe("");
  });

  it("lays out PO items with ordered prefilled and received blank, and uses the PO item unit (NEW-02/03)", async () => {
    mockRoutes();
    render(<CreateGRNForm />);
    await pickPo(/PO\/2026\/0001/);
    await waitFor(() => expect(screen.getByText("reams")).toBeInTheDocument());
    const received = screen.getByLabelText("Received qty row 1") as HTMLInputElement;
    expect(received.value).toBe("0");
  });

  it("derives the vendor from the chosen PO and shows it read-only - there is no vendor picker to diverge (NEW-04)", async () => {
    mockRoutes();
    render(<CreateGRNForm />);
    expect(screen.queryByLabelText("Vendor *")).toBeNull();
    await pickPo(/PO\/2026\/0001/);
    await waitFor(() => expect(screen.getByText("reams")).toBeInTheDocument());
    // The vendor name appears as plain text (not a control).
    expect(screen.getAllByText("Acme Supplies").length).toBeGreaterThan(0);
    expect(screen.queryByRole("combobox", { name: /vendor/i })).toBeNull();
  });

  it("finds a PO beyond the first page by searching the SERVER with ?q= (NEW-04)", async () => {
    const urls: string[] = [];
    mockRoutes(urls);
    render(<CreateGRNForm />);
    const box = await screen.findByLabelText("Purchase order *");
    fireEvent.focus(box);
    fireEvent.change(box, { target: { value: "0777" } });
    fireEvent.mouseDown(await screen.findByRole("option", { name: /PO\/2026\/0777/ }));
    expect(urls.some((u) => u.includes("/pos?") && u.includes("q=0777") && u.includes("limit=25"))).toBe(true);
    await waitFor(() => expect(screen.getAllByText("Far Away Ltd").length).toBeGreaterThan(0));
  });

  it("blocks submit when nothing was received (NEW-02)", async () => {
    mockRoutes();
    render(<CreateGRNForm />);
    await pickPo(/PO\/2026\/0001/);
    await waitFor(() => expect(screen.getByText("reams")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Record GRN" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/received quantity for at least one item/i));
  });

  it("shows a specific over-receipt message when the server returns OVER_RECEIPT (422)", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/grns") && init?.method === "POST") {
        return Promise.resolve(new Response(JSON.stringify({ code: "OVER_RECEIPT", message: "x" }), { status: 422 }));
      }
      if (url.includes(`/pos/${PO.id}`)) return Promise.resolve(new Response(JSON.stringify(PO_DETAIL), { status: 200 }));
      if (url.includes("/pos")) return Promise.resolve(new Response(JSON.stringify({ data: [PO] }), { status: 200 }));
      return Promise.resolve(new Response(JSON.stringify({ data: [] }), { status: 200 }));
    });
    render(<CreateGRNForm />);
    await pickPo(/PO\/2026\/0001/);
    await waitFor(() => expect(screen.getByText("reams")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Received qty row 1"), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "Record GRN" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/exceeds the open quantity on the purchase order/i));
  });

  it("blocks submit when received exceeds ordered (NEW-03)", async () => {
    mockRoutes();
    render(<CreateGRNForm />);
    await pickPo(/PO\/2026\/0001/);
    await waitFor(() => expect(screen.getByText("reams")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Received qty row 1"), { target: { value: "12" } });
    fireEvent.click(screen.getByRole("button", { name: "Record GRN" }));
    await waitFor(() => expect(screen.getByText(/cannot exceed ordered/i)).toBeInTheDocument());
  });

  it("shows an error with Retry - not an empty list - when the PO search fails (NEW-05)", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/pos")) return Promise.resolve(new Response("err", { status: 500 }));
      return Promise.resolve(new Response(JSON.stringify({ data: [] }), { status: 200 }));
    });
    render(<CreateGRNForm />);
    fireEvent.focus(await screen.findByLabelText("Purchase order *"));
    const retry = await screen.findByRole("button", { name: "Retry" });
    expect(retry).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(/Couldn.t load/i);
    expect(screen.queryByText(/Loading/i)).toBeNull();
    expect(screen.queryByText(/No purchase orders found/i)).toBeNull();
  });

  it("Retry succeeds and populates the list (NEW-05)", async () => {
    let healthy = false;
    vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/pos")) {
        return Promise.resolve(healthy ? new Response(JSON.stringify({ data: [PO] }), { status: 200 }) : new Response("err", { status: 500 }));
      }
      return Promise.resolve(new Response(JSON.stringify({ data: [] }), { status: 200 }));
    });
    render(<CreateGRNForm />);
    fireEvent.focus(await screen.findByLabelText("Purchase order *"));
    await screen.findByRole("button", { name: "Retry" });
    healthy = true;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("option", { name: /PO\/2026\/0001/ })).toBeInTheDocument();
  });

  it("an empty list shows 'No purchase orders found' (NEW-05)", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ data: [] }), { status: 200 })));
    render(<CreateGRNForm />);
    fireEvent.focus(await screen.findByLabelText("Purchase order *"));
    expect(await screen.findByText("No purchase orders found.")).toBeInTheDocument();
  });
});

// UAT b10 F95: inventory posts the stock receipt into the GRN's store, so the form must send one.
describe("CreateGRNForm - receiving store (UAT b10 F95)", () => {
  beforeEach(() => { vi.restoreAllMocks(); });
  const STORES = [{ id: "66666666-6666-4666-8666-666666666666", name: "Central Store" }];

  async function fillAccepted() {
    await pickPo(/PO\/2026\/0001/);
    await waitFor(() => expect(screen.getByText("reams")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Received qty row 1"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("Accepted qty row 1"), { target: { value: "2" } });
  }

  it("blocks submit of accepted stock items until a receiving store is chosen", async () => {
    const urls: string[] = [];
    mockRoutes(urls);
    render(<CreateGRNForm stores={STORES} />);
    await fillAccepted();
    fireEvent.click(screen.getByRole("button", { name: "Record GRN" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/receiving store/i));
    expect(urls.some((u) => u.endsWith("/procurement/grns"))).toBe(false);
  });

  it("sends the chosen storeId with the GRN", async () => {
    const calls: Array<{ url: string; body?: string }> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "POST") calls.push({ url, body: String(init.body) });
      if (url.includes(`/pos/${PO.id}`)) return Promise.resolve(new Response(JSON.stringify(PO_DETAIL), { status: 200 }));
      if (url.includes("/pos")) return Promise.resolve(new Response(JSON.stringify({ data: [PO] }), { status: 200 }));
      if (url.includes("/grns")) return Promise.resolve(new Response(JSON.stringify({ id: "new-grn" }), { status: 202 }));
      return Promise.resolve(new Response(JSON.stringify({ data: [] }), { status: 200 }));
    });
    render(<CreateGRNForm stores={STORES} />);
    await fillAccepted();
    fireEvent.change(screen.getByLabelText("Receiving store"), { target: { value: STORES[0]!.id } });
    fireEvent.click(screen.getByRole("button", { name: "Record GRN" }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(JSON.parse(calls[0]!.body!)).toMatchObject({ storeId: STORES[0]!.id });
  });
});
