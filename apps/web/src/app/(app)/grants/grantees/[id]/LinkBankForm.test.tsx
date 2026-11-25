import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as rtlRender, screen, fireEvent, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import { LinkBankForm } from "./LinkBankForm";

const render = (ui: ReactElement) =>
  rtlRender(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);

describe("LinkBankForm", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("sends only last-4 + IFSC to the bank route and echoes a masked value", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 202 }));
    render(<LinkBankForm granteeId="ben-1" />);
    fireEvent.change(screen.getByLabelText(/Account number/), { target: { value: "12ab34" } });
    fireEvent.change(screen.getByLabelText(/IFSC/), { target: { value: "sbin0001234" } });
    fireEvent.change(screen.getByLabelText(/Bank name/), { target: { value: "State Bank of India" } });
    fireEvent.click(screen.getByRole("button", { name: "Link bank account" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("••••1234"));
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("/api/proxy/v1/grants/beneficiaries/ben-1/bank");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      accountNoMasked: "1234",
      bankIfsc: "SBIN0001234",
      bankName: "State Bank of India",
    });
  });

  it("rejects a short account fragment and a malformed IFSC client-side", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    render(<LinkBankForm granteeId="ben-1" />);
    fireEvent.change(screen.getByLabelText(/Account number/), { target: { value: "12" } });
    fireEvent.change(screen.getByLabelText(/IFSC/), { target: { value: "BAD" } });
    fireEvent.click(screen.getByRole("button", { name: "Link bank account" }));
    expect(screen.getAllByRole("alert").length).toBe(2);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
