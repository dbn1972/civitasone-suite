import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import hiMessages from "@/messages/hi.json";
import { NewAllocationForm } from "./NewAllocationForm";

const ACCOUNTS = [
  { id: "3b1c0d2e-0000-4000-8000-000000000001", code: "2202", name: "General Education", type: "expense" },
  { id: "3b1c0d2e-0000-4000-8000-000000000002", code: "1100", name: "Cash / Bank", type: "asset" },
];
const ui = (locale: "en" | "hi" = "en") => (
  <NextIntlClientProvider locale={locale} messages={locale === "hi" ? hiMessages : enMessages}><NewAllocationForm /></NextIntlClientProvider>
);
const posts = (spy: { mock: { calls: unknown[][] } }) => spy.mock.calls.filter(([, i]) => (i as RequestInit | undefined)?.method === "POST");

async function pickHead() {
  fireEvent.change(screen.getByLabelText(/Budget head/), { target: { value: "2202" } });
  fireEvent.mouseDown(await screen.findByText("2202 · General Education"));
  await screen.findByDisplayValue("2202 · General Education");
}

describe("UAT P2 J7: new budget allocation", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.restoreAllMocks();
    fetchSpy = vi.fn(async (url: unknown) => {
      if (String(url).includes("/finance/accounts")) return new Response(JSON.stringify({ data: ACCOUNTS }), { status: 200 });
      return new Response(JSON.stringify({ data: { id: "a1", status: "accepted" } }), { status: 202 });
    });
    vi.stubGlobal("fetch", fetchSpy);
  });

  it("empty and invalid input show written field messages and send nothing", async () => {
    render(ui());
    fireEvent.change(screen.getByLabelText("Financial year"), { target: { value: "2026-28" } });
    fireEvent.change(screen.getByLabelText("Amount to allocate (₹)"), { target: { value: "-5" } });
    fireEvent.click(screen.getByRole("button", { name: "Save allocation" }));
    expect(await screen.findByText("Choose the budget head to allocate to.")).toBeInTheDocument();
    expect(screen.getByText(/Enter a valid financial year/)).toBeInTheDocument();
    expect(screen.getByText(/Enter an amount in rupees greater than 0/)).toBeInTheDocument();
    expect(posts(fetchSpy)).toHaveLength(0);
  });

  it("only expenditure heads are offered", async () => {
    render(ui());
    fireEvent.change(screen.getByLabelText(/Budget head/), { target: { value: "1" } });
    expect(await screen.findByText("2202 · General Education")).toBeInTheDocument();
    expect(screen.queryByText("1100 · Cash / Bank")).not.toBeInTheDocument();
  });

  it("confirms, then posts the head, FY and exact paise to the existing allocation command", async () => {
    render(ui());
    await pickHead();
    fireEvent.change(screen.getByLabelText("Financial year"), { target: { value: "2026-27" } });
    fireEvent.change(screen.getByLabelText("Amount to allocate (₹)"), { target: { value: "270000.10" } });
    fireEvent.click(screen.getByRole("button", { name: "Save allocation" }));
    expect(posts(fetchSpy)).toHaveLength(0);
    expect(screen.getByText(/Allocate ₹2,70,000\.10 to 2202 · General Education for FY 2026-27/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Confirm allocation" }));
    await waitFor(() => expect(posts(fetchSpy)).toHaveLength(1));
    const [url, init] = posts(fetchSpy)[0]! as [string, RequestInit];
    expect(url).toBe("/api/proxy/v1/finance/budget-allocations");
    expect(JSON.parse(init.body as string)).toEqual({ headId: ACCOUNTS[0]!.id, fy: "2026-27", allocatedMinor: "27000010" });
    expect(await screen.findByText(/Allocation saved/)).toBeInTheDocument();
  });

  it("a refused save is a readable message, not raw JSON", async () => {
    fetchSpy.mockImplementation(async (url: unknown) => {
      if (String(url).includes("/finance/accounts")) return new Response(JSON.stringify({ data: ACCOUNTS }), { status: 200 });
      return new Response(JSON.stringify({ code: "FORBIDDEN", message: "role" }), { status: 403 });
    });
    render(ui());
    await pickHead();
    fireEvent.change(screen.getByLabelText("Amount to allocate (₹)"), { target: { value: "100" } });
    fireEvent.click(screen.getByRole("button", { name: "Save allocation" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm allocation" }));
    await waitFor(() => expect(posts(fetchSpy)).toHaveLength(1));
    await waitFor(() => expect(screen.queryByText(/Allocation saved/)).not.toBeInTheDocument());
    expect(screen.queryByText(/"code"/)).not.toBeInTheDocument();
  });

  it("renders in Hindi", () => {
    render(ui("hi"));
    expect(screen.getByRole("button", { name: "आवंटन सहेजें" })).toBeInTheDocument();
  });
});
