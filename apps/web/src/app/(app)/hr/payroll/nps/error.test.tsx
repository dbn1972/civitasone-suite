import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import ErrorBoundary from "./error";

// GAP-PAYROLL-NPS-07: the error boundary's back link must match the page
// header (/hr/payroll), not /hr.
describe("NPS error boundary", () => {
  it("links back to /hr/payroll with a 'Back to Payroll' label", () => {
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <ErrorBoundary error={new Error("boom")} reset={() => {}} />
      </NextIntlClientProvider>,
    );
    const link = screen.getByRole("link", { name: "Back to Payroll" });
    expect(link).toHaveAttribute("href", "/hr/payroll");
  });
});
