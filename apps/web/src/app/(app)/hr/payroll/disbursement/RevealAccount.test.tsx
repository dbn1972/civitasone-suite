import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import { RevealAccount } from "./RevealAccount";

const FULL = "123456789012";

function renderIt(props: Partial<React.ComponentProps<typeof RevealAccount>> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <RevealAccount transferId="tx-1" last4="9012" employeeName="Asha Rao" canReveal {...props} />
    </NextIntlClientProvider>,
  );
}

describe("RevealAccount (GAP-PAYROLL-DISBURSEMENT-01)", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

  it("shows only the masked tail by default: no full number anywhere in the DOM", () => {
    renderIt();
    expect(screen.getByText("••••9012")).toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain(FULL);
  });

  it("without the reveal permission there is no Reveal control at all", () => {
    renderIt({ canReveal: false });
    expect(screen.queryByRole("button", { name: /reveal/i })).not.toBeInTheDocument();
    expect(screen.getByText("••••9012")).toBeInTheDocument();
  });

  it("Reveal needs a reason of 10+ characters, calls the reveal endpoint exactly once with it, then shows the number", async () => {
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ data: { accountNumber: FULL, ifsc: "SBIN0001234", visibleSeconds: 30 } }), { status: 200 }));
    renderIt();
    fireEvent.click(screen.getByRole("button", { name: "Reveal full account number for Asha Rao" }));
    const confirm = screen.getByRole("button", { name: "Reveal" });
    expect(confirm).toBeDisabled();
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(/^Reason \(recorded in the audit log\)/), { target: { value: "too short" } });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/^Reason \(recorded in the audit log\)/), { target: { value: "Matching the bank statement line" } });
    fireEvent.click(confirm);

    await waitFor(() => expect(screen.getByText(FULL)).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/proxy/v1/payroll/disbursement/transfers/tx-1/reveal-account");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ reason: "Matching the bank statement line" });
  });

  it("hides the number again after the server-stated 30 seconds, and on demand", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ data: { accountNumber: FULL, ifsc: "SBIN0001234", visibleSeconds: 30 } }), { status: 200 }));
    renderIt();
    fireEvent.click(screen.getByRole("button", { name: "Reveal full account number for Asha Rao" }));
    fireEvent.change(screen.getByLabelText(/^Reason/), { target: { value: "Matching the bank statement line" } });
    fireEvent.click(screen.getByRole("button", { name: "Reveal" }));
    await waitFor(() => expect(screen.getByText(FULL)).toBeInTheDocument());

    await act(async () => { vi.advanceTimersByTime(29_000); });
    expect(screen.getByText(FULL)).toBeInTheDocument();
    await act(async () => { vi.advanceTimersByTime(1_500); });
    expect(screen.queryByText(FULL)).not.toBeInTheDocument();
    expect(screen.getByText("••••9012")).toBeInTheDocument();

    // manual hide
    fireEvent.click(screen.getByRole("button", { name: "Reveal full account number for Asha Rao" }));
    fireEvent.change(screen.getByLabelText(/^Reason/), { target: { value: "Second look for the same payment" } });
    fireEvent.click(screen.getByRole("button", { name: "Reveal" }));
    await waitFor(() => expect(screen.getByText(FULL)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Hide" }));
    expect(screen.queryByText(FULL)).not.toBeInTheDocument();
  });

  it("a refused reveal (e.g. 403) shows the error in the dialog and never shows a number", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ code: "FORBIDDEN", message: "role not permitted" }), { status: 403 }));
    renderIt();
    fireEvent.click(screen.getByRole("button", { name: "Reveal full account number for Asha Rao" }));
    fireEvent.change(screen.getByLabelText(/^Reason/), { target: { value: "Matching the bank statement line" } });
    fireEvent.click(screen.getByRole("button", { name: "Reveal" }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(document.body.innerHTML).not.toContain(FULL);
  });
});
