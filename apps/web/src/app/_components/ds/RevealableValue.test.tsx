import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render as rtlRender, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import { RevealableValue } from "./RevealableValue";

function render(ui: React.ReactElement) {
  return rtlRender(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);
}

const props = {
  maskedText: "********9012",
  revealPath: "v1/finance/vendors/v1/reveal",
  revealBody: { fields: ["bankAccount"] },
  pick: (j: unknown) => (j as { values?: { bankAccount?: string } })?.values?.bankAccount,
  label: "account number",
};

describe("RevealableValue (audited reveal)", () => {
  beforeEach(() => { vi.restoreAllMocks(); });
  afterEach(() => { vi.useRealTimers(); });

  it("shows only the masked text and NO reveal control to a user who cannot reveal", () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const { container } = render(<RevealableValue {...props} canReveal={false} />);
    expect(screen.getByText("********9012")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reveal" })).not.toBeInTheDocument();
    expect(container.textContent).not.toContain("123456789012");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("asks for a reason first, then calls the audited endpoint once and shows the clear value", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ values: { bankAccount: "123456789012" } }), { status: 200 }));
    render(<RevealableValue {...props} canReveal />);
    fireEvent.click(screen.getByRole("button", { name: "Reveal" }));
    // Nothing is fetched until a reason is given.
    expect(fetchMock).not.toHaveBeenCalled();
    const reason = await screen.findByLabelText(/Reason for revealing/i);
    fireEvent.change(reason, { target: { value: "TDS challan" } }); // 11 chars >= 5
    const confirm = screen.getAllByRole("button", { name: "Reveal" }).pop()!;
    fireEvent.click(confirm);
    expect(await screen.findByText("123456789012")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/proxy/v1/finance/vendors/v1/reveal");
    expect(JSON.parse(init.body as string)).toEqual({ fields: ["bankAccount"], reason: "TDS challan" });
    expect(screen.getByRole("button", { name: "Hide" })).toHaveAttribute("aria-pressed", "true");
  });

  it("does not accept a reason shorter than 5 characters", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    render(<RevealableValue {...props} canReveal />);
    fireEvent.click(screen.getByRole("button", { name: "Reveal" }));
    fireEvent.change(await screen.findByLabelText(/Reason for revealing/i), { target: { value: "abc" } });
    const confirm = screen.getAllByRole("button", { name: "Reveal" }).pop()!;
    expect(confirm).toBeDisabled();
    fireEvent.click(confirm);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a refused reveal (403) shows a plain message and never the clear value", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ code: "FORBIDDEN", message: "requires one of: finance_officer" }), { status: 403 }));
    const { container } = render(<RevealableValue {...props} canReveal />);
    fireEvent.click(screen.getByRole("button", { name: "Reveal" }));
    fireEvent.change(await screen.findByLabelText(/Reason for revealing/i), { target: { value: "reconciliation" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Reveal" }).pop()!);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).not.toMatch(/FORBIDDEN|finance_officer|403/);
    expect(container.textContent).not.toContain("123456789012");
    expect(screen.getByText("********9012")).toBeInTheDocument();
  });

  it("re-masks itself after the timeout and on Hide", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ values: { bankAccount: "123456789012" } }), { status: 200 }));
    render(<RevealableValue {...props} canReveal autoHideMs={50} />);
    fireEvent.click(screen.getByRole("button", { name: "Reveal" }));
    fireEvent.change(await screen.findByLabelText(/Reason for revealing/i), { target: { value: "reconciliation" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Reveal" }).pop()!);
    await screen.findByText("123456789012");
    await waitFor(() => expect(screen.queryByText("123456789012")).not.toBeInTheDocument(), { timeout: 1500 });
    expect(screen.getByText("********9012")).toBeInTheDocument();
  });

  it("shows the fallback when there is nothing to mask", () => {
    render(<RevealableValue {...props} maskedText="" canReveal fallback="—" />);
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reveal" })).not.toBeInTheDocument();
  });
});
