import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: vi.fn() }),
}));

import { PeriodSelector } from "./PeriodSelector";

function renderSelector(period = "2026-06", formType: "24Q" | "26Q" = "24Q") {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <PeriodSelector period={period} formType={formType} />
    </NextIntlClientProvider>,
  );
}

// GAP-PAYROLL-STATUTORY-CHALLANS-04: the form-type select pushes formType into the URL, which the
// page forwards to both the challans and the reconciliation loaders.
describe("PeriodSelector", () => {
  beforeEach(() => pushMock.mockReset());

  it("starts on the form type in the URL", () => {
    renderSelector("2026-06", "26Q");
    expect(screen.getByLabelText("Form Type")).toHaveValue("26Q");
  });

  it("selecting 26Q and submitting navigates with formType=26Q and the period", () => {
    renderSelector("2026-06", "24Q");
    fireEvent.change(screen.getByLabelText("Form Type"), { target: { value: "26Q" } });
    fireEvent.click(screen.getByRole("button", { name: "View Period" }));
    expect(pushMock).toHaveBeenCalledWith("/hr/payroll/statutory/challans?period=2026-06&formType=26Q");
  });

  it("switching back to 24Q navigates with formType=24Q", () => {
    renderSelector("2026-06", "26Q");
    fireEvent.change(screen.getByLabelText("Form Type"), { target: { value: "24Q" } });
    fireEvent.click(screen.getByRole("button", { name: "View Period" }));
    expect(pushMock).toHaveBeenCalledWith("/hr/payroll/statutory/challans?period=2026-06&formType=24Q");
  });

  it("a malformed period is refused with an alert and no navigation", () => {
    renderSelector("2026-06", "26Q");
    fireEvent.change(screen.getByLabelText(/^Period/), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "View Period" }));
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });
});
