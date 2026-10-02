import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import { SubmitPaymentForm } from "./SubmitPaymentForm";
import type { PfmsPaymentRail } from "./types";

// GAP-FINANCE-PFMS-05: Submit Payment posts to the e-Kuber ADAPTER route, which
// has no sandbox. Its copy follows the adapter's own state and never says
// "simulated".
function fill(rail: PfmsPaymentRail | null) {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <SubmitPaymentForm rail={rail} />
    </NextIntlClientProvider>,
  );
  fireEvent.change(screen.getByLabelText(/Reference ID/), { target: { value: "REF-1" } });
  fireEvent.change(screen.getByLabelText(/Beneficiary Code/), { target: { value: "BEN-1" } });
  fireEvent.change(screen.getByLabelText(/Amount \(₹\)/), { target: { value: "1,500" } });
  fireEvent.change(screen.getByLabelText(/Purpose Code/), { target: { value: "PUR01" } });
}

describe("SubmitPaymentForm adapter-rail copy", () => {
  it("live: says a real payment is initiated", async () => {
    fill("live");
    fireEvent.click(screen.getByRole("button", { name: "Submit Payment" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/initiates a real payment submission/)).toBeInTheDocument();
  });

  it("disabled: the submit button is disabled and no dialog can open", () => {
    fill("disabled");
    const button = screen.getByRole("button", { name: "Submit Payment" });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("unknown (null): neutral copy that does not claim a real payment, and never says simulated", async () => {
    fill(null);
    fireEvent.click(screen.getByRole("button", { name: "Submit Payment" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toMatch(/did not say whether PFMS payments are enabled/);
    expect(dialog.textContent).not.toMatch(/initiates a real payment submission/);
    expect(dialog.textContent).not.toMatch(/simulat/i);
  });

  it("never offers a simulate wording in any rail state", () => {
    for (const rail of ["live", "disabled", null] as const) {
      const { unmount } = render(
        <NextIntlClientProvider locale="en" messages={enMessages}>
          <SubmitPaymentForm rail={rail} />
        </NextIntlClientProvider>,
      );
      expect(screen.queryByText(/Simulate/i)).not.toBeInTheDocument();
      unmount();
    }
  });
});
