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
