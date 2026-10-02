import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import Loading from "./loading";

// GAP-PAYROLL-CORRECTIONS-06: the loading state used to be one bare grey
// bar; it now carries the page header and stat/table placeholders.
describe("corrections loading state", () => {
  it("renders the page header, four stat placeholders and a labelled status region", async () => {
    const ui = await Loading();
    const { container } = render(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveAttribute("aria-label");
    expect(container.querySelector(".skeleton")).toBeNull();
    // 4 stat tiles + table skeleton rows
    expect(container.querySelectorAll('[aria-hidden="true"]').length).toBeGreaterThanOrEqual(5);
  });
});
