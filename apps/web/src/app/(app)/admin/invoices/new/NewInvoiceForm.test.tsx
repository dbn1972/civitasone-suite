import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import hiMessages from "@/messages/hi.json";
import { NewInvoiceForm } from "./NewInvoiceForm";

const TENANT = "11111111-0000-0000-0000-000000000001";
const ID = "7fde1e7f-0741-4e2c-b25b-703dd937ee4f";
const ui = (locale: "en" | "hi" = "en") => (
  <NextIntlClientProvider locale={locale} messages={locale === "hi" ? hiMessages : enMessages}><NewInvoiceForm tenantId={TENANT} /></NextIntlClientProvider>
);
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });

describe("UAT P2 J8: New invoice screen", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.restoreAllMocks();
    fetchSpy = vi.fn(async () => json({ id: ID, status: "accepted", correlationId: "c" }, 202));
    vi.stubGlobal("fetch", fetchSpy);
  });

  it("an empty submit shows written field messages and sends nothing", async () => {
    render(ui());
    fireEvent.click(screen.getByRole("button", { name: "Save draft invoice" }));
    expect(await screen.findByText(/Enter the billing period as year and month/)).toBeInTheDocument();
    expect(screen.getByText(/Enter a description/)).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("confirms, then creates the draft through POST /v1/billing/invoices and links to it", async () => {
    render(ui());
    fireEvent.change(screen.getByLabelText("Billing period (YYYY-MM)"), { target: { value: "2026-11" } });
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "Platform fee" } });
    fireEvent.change(screen.getByLabelText("Rate (₹)"), { target: { value: "2500" } });
    expect(screen.getByTestId("invoice-total")).toHaveTextContent("₹2,500.00");
    fireEvent.click(screen.getByRole("button", { name: "Save draft invoice" }));
    expect(fetchSpy).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    const [url, init] = fetchSpy.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe("/api/proxy/v1/billing/invoices");
    expect(JSON.parse(init.body as string)).toEqual({
      tenantId: TENANT, periodMonth: "2026-11", items: [{ description: "Platform fee", kind: "line", quantity: 1, amountMinor: 250000 }],
    });
    expect(await screen.findByRole("link", { name: "Open the draft invoice" })).toHaveAttribute("href", `/admin/invoices/${ID}`);
  });

  it("a period that already has an invoice is explained in plain words", async () => {
    fetchSpy.mockImplementation(async () => json({ code: "INVOICE_PERIOD_EXISTS", message: "an invoice (x, status draft) already exists" }, 409));
    render(ui());
    fireEvent.change(screen.getByLabelText("Billing period (YYYY-MM)"), { target: { value: "2026-11" } });
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "Platform fee" } });
    fireEvent.change(screen.getByLabelText("Rate (₹)"), { target: { value: "2500" } });
    fireEvent.click(screen.getByRole("button", { name: "Save draft invoice" }));
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    expect(await screen.findByText(/An invoice already exists for this billing period/)).toBeInTheDocument();
  });

  it("renders in Hindi", () => {
    render(ui("hi"));
    expect(screen.getByRole("button", { name: "मसौदा बीजक सहेजें" })).toBeInTheDocument();
  });
});
