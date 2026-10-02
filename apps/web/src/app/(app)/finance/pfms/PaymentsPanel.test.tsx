import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import { PaymentsPanel } from "./PaymentsPanel";
import type { PfmsMode, PfmsPaymentRail } from "./types";

function renderPanel(paymentRail: PfmsPaymentRail | null, treasury: PfmsMode | null = null) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <PaymentsPanel paymentRail={paymentRail} initialTreasuryMode={treasury} />
    </NextIntlClientProvider>,
  );
}
const visiblePanel = () =>
  Array.from(document.querySelectorAll("[role=tabpanel]")).find((p) => !(p as HTMLElement).hidden) as HTMLElement;

// GAP-FINANCE-PFMS-05: each form's banner follows the integration it calls.
describe("PaymentsPanel banners per integration", () => {
  it("Submit Payment: adapter rail live -> live banner, never a sandbox/simulated one", () => {
    renderPanel("live", "sandbox"); // treasury sandbox must NOT leak onto the adapter forms
    const panel = visiblePanel();
    expect(panel.querySelector("[data-pfms-rail=live]")).not.toBeNull();
    expect(panel.querySelector("[data-pfms-mode]")).toBeNull();
    expect(panel.textContent).not.toMatch(/simulat/i);
  });

  it("Submit Payment: adapter disabled -> 'disabled on this server' and submit is disabled", () => {
    renderPanel("disabled", "live");
    expect(visiblePanel().textContent).toContain("PFMS payments are disabled on this server");
    expect(screen.getByRole("button", { name: "Submit Payment" })).toBeDisabled();
  });

  it("Submit Payment: unknown rail -> unknown banner, not assumed simulated", () => {
    renderPanel(null, "sandbox");
    const panel = visiblePanel();
    expect(panel.querySelector("[data-pfms-rail=unknown]")).not.toBeNull();
    expect(panel.textContent).not.toMatch(/simulat/i);
  });

  it("Payment Status uses the same adapter-rail banner", () => {
    renderPanel("disabled", "sandbox");
    fireEvent.click(screen.getByRole("tab", { name: "Payment Status" }));
    expect(visiblePanel().querySelector("[data-pfms-rail=disabled]")).not.toBeNull();
  });

  it("Salary Bill and Payment Advice follow the TREASURY mode, independent of the rail", () => {
    renderPanel("disabled", "sandbox");
    fireEvent.click(screen.getByRole("tab", { name: "Salary Bill" }));
    expect(visiblePanel().querySelector("[data-pfms-mode=sandbox]")).not.toBeNull();
    expect(visiblePanel().querySelector("[data-pfms-rail]")).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "Payment Advice" }));
    expect(visiblePanel().querySelector("[data-pfms-mode=sandbox]")).not.toBeNull();
  });

  it("treasury live and unknown", () => {
    const { unmount } = renderPanel("live", "live");
    fireEvent.click(screen.getByRole("tab", { name: "Salary Bill" }));
    expect(visiblePanel().querySelector("[data-pfms-mode=live]")).not.toBeNull();
    unmount();
    renderPanel("live", null);
    fireEvent.click(screen.getByRole("tab", { name: "Salary Bill" }));
    expect(visiblePanel().querySelector("[data-pfms-mode=unknown]")).not.toBeNull();
  });
});

describe("PaymentsPanel sub-tabs (GAP-FINANCE-PFMS-06)", () => {
  it("offers four labelled sub-tabs and shows one form at a time", () => {
    renderPanel("live");
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Submit Payment", "Payment Status", "Salary Bill", "Payment Advice"]);
    const panels = document.querySelectorAll("[role=tabpanel]");
    expect(panels).toHaveLength(4);
    expect(Array.from(panels).filter((p) => !(p as HTMLElement).hidden)).toHaveLength(1);
    fireEvent.click(screen.getByRole("tab", { name: "Payment Advice" }));
    expect(visiblePanel().textContent).toContain("Generate Payment Advice");
  });

  it("keeps typed values when switching sub-tabs and back", () => {
    renderPanel("live");
    fireEvent.change(screen.getByLabelText(/Reference ID/), { target: { value: "REF-KEEP" } });
    fireEvent.click(screen.getByRole("tab", { name: "Salary Bill" }));
    fireEvent.click(screen.getByRole("tab", { name: "Submit Payment" }));
    expect((screen.getByLabelText(/Reference ID/) as HTMLInputElement).value).toBe("REF-KEEP");
  });
});
