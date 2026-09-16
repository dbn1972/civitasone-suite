import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import { ServiceBookView, type ServiceEntry } from "./ServiceBookView";

function makeEntries(count: number): ServiceEntry[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `e${i}`,
    employee: `Employee ${i}`,
    eventType: "join",
    effectiveDate: new Date(2020, 0, i + 1).toISOString(),
  }));
}

function renderView(entries: ServiceEntry[]) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <ServiceBookView entries={entries} />
    </NextIntlClientProvider>,
  );
}

// UX-008 tranche 2: the Previous (←) / Next (→) pager controls were ad hoc
// inline-styled (no shared design-system class) -- converted onto the
// shared Button component. The numbered page buttons were left untouched:
// each carries a 3rd "current page" state (highlighted vs not) that doesn't
// fit Button's binary variant model, unlike the simple enabled/disabled
// Previous/Next pair. No prior test existed for this file, so this covers
// pagination.
describe("ServiceBookView pagination", () => {
  it("disables Previous on the first page and Next advances the page", () => {
    renderView(makeEntries(40));
    expect(screen.getByRole("button", { name: "Previous page" })).toBeDisabled();
    expect(screen.getByText("Employee 0")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(screen.getByText("Employee 15")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous page" })).toBeEnabled();
  });

  it("disables Next on the last page", () => {
    renderView(makeEntries(40));
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();
  });

  it("does not render pagination controls when everything fits on one page", () => {
    renderView(makeEntries(5));
    expect(screen.queryByRole("button", { name: "Previous page" })).not.toBeInTheDocument();
  });
});
