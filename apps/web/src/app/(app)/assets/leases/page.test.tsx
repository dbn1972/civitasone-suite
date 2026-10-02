import { describe, it, expect, vi, beforeEach, type MockInstance } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import LeasesPage from "./page";

function fill() {
  fireEvent.change(screen.getByLabelText("Lease no."), { target: { value: "L-7" } });
  fireEvent.change(screen.getByLabelText("Lessor"), { target: { value: "Acme Realty" } });
  fireEvent.change(screen.getByLabelText("ROU cost (₹)"), { target: { value: "1200000.10" } });
  fireEvent.change(screen.getByLabelText("Liability (₹)"), { target: { value: "1150000" } });
  fireEvent.change(screen.getByLabelText("Lease start"), { target: { value: "2026-04-01" } });
  fireEvent.change(screen.getByLabelText("Lease end"), { target: { value: "2031-03-31" } });
}

// GAP-ASSETS-LEASES-01
describe("LeasesPage register", () => {
  let fetchSpy: MockInstance<typeof fetch>;
  beforeEach(() => {
    vi.restoreAllMocks();
    fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) =>
      (init as RequestInit | undefined)?.method === "POST"
        ? new Response(JSON.stringify({ id: "l1", status: "accepted" }), { status: 202 })
        : new Response(JSON.stringify({ data: [] }), { status: 200 }),
    );
  });
  const posts = () => fetchSpy.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === "POST");

  it("opens a confirm dialog with the amounts and does not POST until Confirm", async () => {
    render(<LeasesPage />);
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Register lease" }));
    await waitFor(() => expect(screen.getByText("Register this IFRS 16 lease?")).toBeInTheDocument());
    expect(screen.getByText("₹12,00,000.10")).toBeInTheDocument();
    expect(posts()).toHaveLength(0);
    fireEvent.click(screen.getAllByRole("button", { name: "Register lease" }).at(-1)!);
    await waitFor(() => expect(posts()).toHaveLength(1));
    const body = JSON.parse((posts()[0]![1] as RequestInit).body as string);
    expect(body.rouCostMinor).toBe(120000010);
    expect(body.liabilityMinor).toBe(115000000);
    expect(await screen.findByText(/Lease L-7 submitted/)).toBeInTheDocument();
  });

  it("Cancel keeps the entered values and sends nothing", async () => {
    render(<LeasesPage />);
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Register lease" }));
    await waitFor(() => expect(screen.getByText("Register this IFRS 16 lease?")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(posts()).toHaveLength(0);
    expect(screen.getByLabelText("Lease no.")).toHaveValue("L-7");
  });

  it("shows a server error inside the dialog", async () => {
    fetchSpy.mockImplementation(async (_url, init) =>
      (init as RequestInit | undefined)?.method === "POST" ? new Response("duplicate lease number", { status: 409 }) : new Response(JSON.stringify({ data: [] }), { status: 200 }),
    );
    render(<LeasesPage />);
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Register lease" }));
    await waitFor(() => expect(screen.getByText("Register this IFRS 16 lease?")).toBeInTheDocument());
    fireEvent.click(screen.getAllByRole("button", { name: "Register lease" }).at(-1)!);
    expect(await screen.findByText(/duplicate lease number/)).toBeInTheDocument();
  });

  it("rejects an invalid amount before opening the dialog", () => {
    render(<LeasesPage />);
    fill();
    fireEvent.change(screen.getByLabelText("ROU cost (₹)"), { target: { value: "12,00,000" } });
    fireEvent.click(screen.getByRole("button", { name: "Register lease" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/valid ROU cost/);
    expect(screen.queryByText("Register this IFRS 16 lease?")).not.toBeInTheDocument();
  });

  it("rejects an amount beyond safe-integer paise", () => {
    render(<LeasesPage />);
    fill();
    fireEvent.change(screen.getByLabelText("ROU cost (₹)"), { target: { value: "999999999999999999" } });
    fireEvent.click(screen.getByRole("button", { name: "Register lease" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/valid ROU cost/);
  });
});

// GAP-ASSETS-LEASES-02 / 03 / 05 / 06
describe("LeasesPage list and form", () => {
  const leaseRow = {
    id: "l1", leaseNo: "L-1", lessorName: "Acme Realty", rouCostMinor: 10000000, liabilityMinor: 9000000,
    leaseStart: "2026-04-01", leaseEnd: "2031-03-31", assetId: "asset-9", status: "active",
  };
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("shows ROU cost, liability and a status column per lease", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ data: [leaseRow] }), { status: 200 }));
    render(<LeasesPage />);
    expect(await screen.findByText("₹1,00,000.00")).toBeInTheDocument();
    expect(screen.getByText("₹90,000.00")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /Liability/ })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /Status/ })).toBeInTheDocument();
  });

  it("renders the asset View as a client link with a lease-specific accessible name", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ data: [leaseRow] }), { status: 200 }));
    render(<LeasesPage />);
    const link = await screen.findByRole("link", { name: "View asset for lease L-1" });
    expect(link).toHaveAttribute("href", "/assets/asset-9");
  });

  it("shows a skeleton, not empty-state copy, while loading", () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() => new Promise(() => {}));
    render(<LeasesPage />);
    expect(screen.queryByText(/Loading leases/)).not.toBeInTheDocument();
    expect(screen.getByLabelText("Loading leases")).toHaveAttribute("aria-busy", "true");
  });

  it("paginates at 15 rows", async () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ ...leaseRow, id: `l${i}`, leaseNo: `L-${i}` }));
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ data: many }), { status: 200 }));
    render(<LeasesPage />);
    await screen.findByText(/Page 1 of 2/);
  });

  it("limits the lease-end date picker to on/after the lease start and explains the digits-only money format", () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ data: [] }), { status: 200 }));
    render(<LeasesPage />);
    fireEvent.change(screen.getByLabelText("Lease start"), { target: { value: "2026-04-01" } });
    expect(screen.getByLabelText("Lease end")).toHaveAttribute("min", "2026-04-01");
    expect(screen.getByText(/digits only/)).toBeInTheDocument();
  });

  it("blocks an end date on/before the start with an inline error and no POST", () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ data: [] }), { status: 200 }));
    render(<LeasesPage />);
    fill();
    fireEvent.change(screen.getByLabelText("Lease end"), { target: { value: "2026-03-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Register lease" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/end must be after/i);
    expect(spy.mock.calls.filter(([, i]) => (i as RequestInit | undefined)?.method === "POST")).toHaveLength(0);
  });
});
