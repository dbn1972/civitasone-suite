import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { NewExpenseClaimForm } from "./NewExpenseClaimForm";

function renderForm() {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <NewExpenseClaimForm />
    </NextIntlClientProvider>,
  );
}

describe("NewExpenseClaimForm — GAP-HR-EXPENSES-02", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    refreshMock.mockReset();
    fetchMock.mockReset().mockResolvedValue(new Response(JSON.stringify({ id: "new-id", status: "pending" }), { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  async function openForm() {
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: /new claim/i }));
    await waitFor(() => expect(screen.getByLabelText(/amount/i)).toBeInTheDocument());
  }

  it("converts a rupee amount to exact paise via parseRupeesToPaise, not float math, in the POST body", async () => {
    await openForm();
    fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: "1234.56" } });
    fireEvent.change(screen.getByLabelText(/date/i), { target: { value: "2026-08-02" } });
    fireEvent.click(screen.getByRole("button", { name: /submit/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/proxy/v1/hrms/expenses",
      expect.objectContaining({ method: "POST" }),
    ));
    const call = fetchMock.mock.calls.find((c) => c[0] === "/api/proxy/v1/hrms/expenses");
    const body = JSON.parse((call?.[1] as RequestInit).body as string);
    expect(body.amount).toBe(123456);
    expect(Number.isInteger(body.amount)).toBe(true);
  });

  it("blocks submission and shows a field error for an unparsiable amount, without ever calling fetch", async () => {
    await openForm();
    fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: "not-a-number" } });
    fireEvent.change(screen.getByLabelText(/date/i), { target: { value: "2026-08-02" } });
    fireEvent.click(screen.getByRole("button", { name: /submit/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows a clerk-safe message, never the raw HTTP status, on a failed submission", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 500 }));
    await openForm();
    fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: "500" } });
    fireEvent.change(screen.getByLabelText(/date/i), { target: { value: "2026-08-02" } });
    fireEvent.click(screen.getByRole("button", { name: /submit/i }));

    const alert = await screen.findByRole("alert");
    await waitFor(() => expect(alert).toHaveTextContent(/couldn't save/i));
    expect(alert.textContent).not.toMatch(/\b500\b/);
  });
});
