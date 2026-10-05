import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import ErrorBoundary from "./error";

// GAP-CRM-DEALS-DETAIL-03: the error boundary used to pass the unreplaced
// placeholder area="CRM [Id]", so the clerk saw "...the CRM [Id]...". It must
// name the deal and link back to the engagements list.
describe("Deal detail error boundary", () => {
  it("renders a deal-specific message, not the 'CRM [Id]' placeholder", () => {
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <ErrorBoundary error={new Error("boom")} reset={() => {}} />
      </NextIntlClientProvider>,
    );
    // The friendly sentence names "deal" and never leaks the placeholder.
    expect(screen.getByText(/deal/i)).toBeInTheDocument();
    expect(screen.queryByText(/CRM \[Id\]/i)).not.toBeInTheDocument();
  });

  it("links back to the engagements list", () => {
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <ErrorBoundary error={new Error("boom")} reset={() => {}} />
      </NextIntlClientProvider>,
    );
    const link = screen.getByRole("link", { name: "Back to engagements" });
    expect(link).toHaveAttribute("href", "/crm/deals");
  });
});
