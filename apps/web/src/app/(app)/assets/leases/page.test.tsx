import { describe, it, expect, vi, beforeEach, type MockInstance } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import LeasesPage from "./page";
import { renderIntl as render } from "../testIntl";

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
    await waitFor(() => expect(screen.getByText("Register this lease?")).toBeInTheDocument());
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
    await waitFor(() => expect(screen.getByText("Register this lease?")).toBeInTheDocument());
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
    await waitFor(() => expect(screen.getByText("Register this lease?")).toBeInTheDocument());
    fireEvent.click(screen.getAllByRole("button", { name: "Register lease" }).at(-1)!);
    // plain copy, never the raw response body
    expect(await screen.findByText(/couldn't save/i)).toBeInTheDocument();
    expect(screen.queryByText(/duplicate lease number/)).not.toBeInTheDocument();
  });

  // fp-assets-01: GL heads
  it("refuses with a clear (translated) message when GL accounts are not configured, and shows no raw server text", async () => {
    fetchSpy.mockImplementation(async (_url, init) =>
      (init as RequestInit | undefined)?.method === "POST"
        ? new Response(JSON.stringify({ code: "ASSET_GL_NOT_CONFIGURED", message: "server text" }), { status: 409 })
        : new Response(JSON.stringify({ data: [] }), { status: 200 }));
    render(<LeasesPage />);
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Register lease" }));
    await waitFor(() => expect(screen.getByText("Register this lease?")).toBeInTheDocument());
    fireEvent.click(screen.getAllByRole("button", { name: "Register lease" }).at(-1)!);
    expect(await screen.findByText(/GL accounts are not set up yet/)).toBeInTheDocument();
    expect(screen.queryByText(/server text/)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Asset settings" })).toHaveAttribute("href", "/assets/settings");
  });

  it("shows the Hindi message too", async () => {
    fetchSpy.mockImplementation(async (_url, init) =>
      (init as RequestInit | undefined)?.method === "POST"
        ? new Response(JSON.stringify({ code: "GL_HEAD_INVALID" }), { status: 409 })
        : new Response(JSON.stringify({ data: [] }), { status: 200 }));
    render(<LeasesPage />, "hi");
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Register lease" }));
    await waitFor(() => expect(screen.getByText("Register this lease?")).toBeInTheDocument());
    fireEvent.click(screen.getAllByRole("button", { name: "Register lease" }).at(-1)!);
    expect(await screen.findByText(/स्वीकार नहीं किया गया/)).toBeInTheDocument();
  });

  it("offers Repost only on a failed journal, confirms first, then posts to the lease repost route", async () => {
    const base = { leaseStart: "2026-04-01", leaseEnd: "2031-03-31", assetId: null, status: "active", rouCostMinor: 1000, liabilityMinor: 900 };
    fetchSpy.mockImplementation(async (url, init) =>
      (init as RequestInit | undefined)?.method === "POST"
        ? new Response(JSON.stringify({ id: "c" }), { status: 202 })
        : new Response(JSON.stringify({ data: [
            { ...base, id: "p", leaseNo: "L-P", lessorName: "P", glPostStatus: "pending" },
            { ...base, id: "c", leaseNo: "L-C", lessorName: "C", glPostStatus: "failed" },
          ] }), { status: 200 }));
    render(<LeasesPage />);
    expect(await screen.findByText("Journal not posted")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Repost journal/ })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Repost journal: L-C" }));
    expect(await screen.findByText("Repost this journal?")).toBeInTheDocument();
    expect(posts()).toHaveLength(0);
    fireEvent.click(screen.getByText("Repost"));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(String(posts()[0]![0])).toBe("/api/proxy/v1/asset/leases/c/journal/repost");
    expect(await screen.findByText(/Journal sent to Finance again/)).toBeInTheDocument();
  });

  it("shows the recognition journal state per lease (pending / posted / not posted)", async () => {
    const base = { leaseStart: "2026-04-01", leaseEnd: "2031-03-31", assetId: null, status: "active", rouCostMinor: 1000, liabilityMinor: 900 };
    fetchSpy.mockResolvedValue(new Response(JSON.stringify({ data: [
      { ...base, id: "a", leaseNo: "L-A", lessorName: "A", glPostStatus: "pending" },
      { ...base, id: "b", leaseNo: "L-B", lessorName: "B", glPostStatus: "posted" },
      { ...base, id: "c", leaseNo: "L-C", lessorName: "C", glPostStatus: "failed" },
    ] }), { status: 200 }));
    render(<LeasesPage />);
    expect(await screen.findByText("Journal pending")).toBeInTheDocument();
    expect(screen.getByText("Journal posted")).toBeInTheDocument();
    expect(screen.getByText("Journal not posted").className).toContain("bad");
  });

  // GAP-ASSETS-LEASES-04: no IFRS wording anywhere on the page
  it("uses Ind AS 116 wording, never IFRS 16", async () => {
    render(<LeasesPage />);
    expect(screen.getByRole("heading", { name: "Leases" })).toBeInTheDocument();
    expect(await screen.findByText(/Ind AS 116/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/IFRS/i);
  });

  // GAP-ASSETS-LEASES-07: discounted lease -> the service computes the liability
  it("with a discount rate and payment: previews the present value, confirms it, and posts no user liability", async () => {
    fetchSpy.mockImplementation(async (url, init) => {
      const u = String(url);
      if ((init as RequestInit | undefined)?.method === "POST" && u.endsWith("/leases/preview")) {
        return new Response(JSON.stringify({ liabilityMinor: "11495790", totalInterestMinor: "504210", periods: 12 }), { status: 200 });
      }
      return (init as RequestInit | undefined)?.method === "POST"
        ? new Response(JSON.stringify({ id: "l1", status: "accepted" }), { status: 202 })
        : new Response(JSON.stringify({ data: [] }), { status: 200 });
    });
    render(<LeasesPage />);
    fill();
    fireEvent.change(screen.getByLabelText("Liability (₹)"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText(/Discount rate/), { target: { value: "8" } });
    fireEvent.change(screen.getByLabelText("Periodic payment (₹)"), { target: { value: "10000" } });
    expect(screen.getByLabelText("Liability (₹)")).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Register lease" }));
    await waitFor(() => expect(screen.getByText("Register this lease?")).toBeInTheDocument());
    expect(screen.getByText("₹1,14,957.90")).toBeInTheDocument(); // the service's present value, not typed
    expect(screen.getByText(/present value of 12 monthly payments at 8% a year/)).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Register lease" }).at(-1)!);
    await waitFor(() => expect(posts().filter(([u]) => String(u).endsWith("/leases"))).toHaveLength(1));
    const body = JSON.parse((posts().find(([u]) => String(u).endsWith("/leases"))![1] as RequestInit).body as string);
    expect(body).toMatchObject({ ibrBps: 800, paymentMinor: 1000000, paymentFrequency: "monthly" });
    expect(body.liabilityMinor).toBeUndefined();
  });

  it("requires both discounting fields once either is entered", () => {
    render(<LeasesPage />);
    fill();
    fireEvent.change(screen.getByLabelText(/Discount rate/), { target: { value: "8" } });
    fireEvent.click(screen.getByRole("button", { name: "Register lease" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/periodic payment/);
    fireEvent.change(screen.getByLabelText(/Discount rate/), { target: { value: "abc" } });
    fireEvent.change(screen.getByLabelText("Periodic payment (₹)"), { target: { value: "10000" } });
    fireEvent.click(screen.getByRole("button", { name: "Register lease" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/discount rate/);
    expect(posts()).toHaveLength(0);
  });

  it("a failed preview shows plain copy and opens no dialog", async () => {
    fetchSpy.mockImplementation(async (url, init) =>
      (init as RequestInit | undefined)?.method === "POST" && String(url).endsWith("/leases/preview")
        ? new Response(JSON.stringify({ code: "INVALID_LEASE_TERMS", message: "lease term exceeds 600 periods" }), { status: 400 })
        : new Response(JSON.stringify({ data: [] }), { status: 200 }));
    render(<LeasesPage />);
    fill();
    fireEvent.change(screen.getByLabelText(/Discount rate/), { target: { value: "8" } });
    fireEvent.change(screen.getByLabelText("Periodic payment (₹)"), { target: { value: "10000" } });
    fireEvent.click(screen.getByRole("button", { name: "Register lease" }));
    expect(await screen.findByText(/cannot be scheduled/)).toBeInTheDocument();
    expect(screen.queryByText("Register this lease?")).not.toBeInTheDocument();
  });

  it("opens the repayment schedule of a discounted lease", async () => {
    const row = { id: "l9", leaseNo: "L-9", lessorName: "Acme", rouCostMinor: 1000, liabilityMinor: 900, leaseStart: "2026-04-01", leaseEnd: "2027-03-31", assetId: null, status: "active", ibrBps: 800 };
    fetchSpy.mockImplementation(async (url) => String(url).endsWith("/leases/l9/schedule")
      ? new Response(JSON.stringify({ data: [{ seq: 1, dueDate: "2026-04-30", openingMinor: "90000", interestMinor: "600", paymentMinor: "10000", principalMinor: "9400", closingMinor: "80600" }] }), { status: 200 })
      : new Response(JSON.stringify({ data: [row] }), { status: 200 }));
    render(<LeasesPage />);
    fireEvent.click(await screen.findByRole("button", { name: "View repayment schedule for lease L-9" }));
    expect(await screen.findByText(/Repayment schedule — lease L-9/)).toBeInTheDocument();
    expect(await screen.findByText("₹806.00")).toBeInTheDocument(); // closing balance
  });

  it("rejects an invalid amount before opening the dialog", () => {
    render(<LeasesPage />);
    fill();
    fireEvent.change(screen.getByLabelText("ROU cost (₹)"), { target: { value: "12,00,000" } });
    fireEvent.click(screen.getByRole("button", { name: "Register lease" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/valid ROU cost/);
    expect(screen.queryByText("Register this lease?")).not.toBeInTheDocument();
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
