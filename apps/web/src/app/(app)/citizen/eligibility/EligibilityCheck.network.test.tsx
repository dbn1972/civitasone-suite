import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import { EligibilityCheck } from "./EligibilityCheck";

describe("EligibilityCheck error rendering (CLOS-S1-08)", () => {
  afterEach(() => vi.unstubAllGlobals());
  const run = () => {
    render(<NextIntlClientProvider locale="en" messages={enMessages}><EligibilityCheck services={[{ id: "svc-1", name: "Old Age Pension" }]} /></NextIntlClientProvider>);
    fireEvent.change(screen.getByLabelText("Service"), { target: { value: "svc-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Run check" }));
  };

  it("offline run shows evaluationFailed, not raw 'Failed to fetch'", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))) as unknown as typeof fetch);
    run();
    expect(await screen.findByText(enMessages.citizenEligibility.evaluationFailed)).toBeInTheDocument();
    expect(screen.queryByText("Failed to fetch")).toBeNull();
  });
});
