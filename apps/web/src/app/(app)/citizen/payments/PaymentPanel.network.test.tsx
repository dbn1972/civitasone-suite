import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import { PaymentPanel } from "./PaymentPanel";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

describe("PaymentPanel error rendering (CLOS-S1-10)", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("offline tracking-number resolve shows resolveError, not raw 'Failed to fetch'", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))) as unknown as typeof fetch);
    render(<NextIntlClientProvider locale="en" messages={enMessages}><PaymentPanel schedules={[]} /></NextIntlClientProvider>);
    fireEvent.change(screen.getByLabelText(enMessages.citizenPayments.trackingNoLabel), { target: { value: "TRK-1" } });
    fireEvent.click(screen.getByRole("button", { name: enMessages.citizenPayments.resolveTracking }));
    expect(await screen.findByText(enMessages.citizenPayments.resolveError)).toBeInTheDocument();
    expect(screen.queryByText("Failed to fetch")).toBeNull();
  });
});
