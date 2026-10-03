import { describe, it, expect, vi } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), usePathname: () => "/", useSearchParams: () => new URLSearchParams() }));

import { SchemeTable } from "./SchemeTable";

const scheme = (id: string, outlay: string, utilised: string) => ({
  id, code: `S${id}`, name: `Scheme ${id}`, outlayMinor: outlay, utilisedMinor: utilised, currency: "INR",
  funding: "Central", status: "active", createdAt: "2026-04-01T00:00:00.000Z", updatedAt: "2026-04-01T00:00:00.000Z", version: 1,
});

// GAP-FINANCE-EXPENDITURE-SCHEME-TRACKING-05
describe("SchemeTable utilisation column", () => {
  it("shows the percentage, flags over-utilisation, and uses a dash for zero outlay", () => {
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <SchemeTable schemes={[scheme("1", "10000", "4000"), scheme("2", "10000", "12000"), scheme("3", "0", "500")]} />
      </NextIntlClientProvider>,
    );
    const row = (name: string) => screen.getByText(name).closest("tr") as HTMLElement;
    expect(within(row("Scheme 1")).getByText("40%")).toBeInTheDocument();
    expect(within(row("Scheme 2")).getByText(/120%.*Over-utilised/)).toBeInTheDocument();
    expect(within(row("Scheme 3")).queryByText(/%/)).not.toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /^Utilisation/ })).toBeInTheDocument();
  });

  it("flags 100.3% (a rounded 100% would hide it) and sorts the column numerically", () => {
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <SchemeTable schemes={[scheme("1", "1000", "1003"), scheme("2", "1000", "90"), scheme("3", "1000", "1000")]} />
      </NextIntlClientProvider>,
    );
    const row = (name: string) => screen.getByText(name).closest("tr") as HTMLElement;
    expect(within(row("Scheme 1")).getByText(/100\.3%.*Over-utilised/)).toBeInTheDocument();
    expect(within(row("Scheme 3")).getByText("100%")).toBeInTheDocument();
    expect(within(row("Scheme 3")).queryByText(/Over-utilised/)).not.toBeInTheDocument();
    const header = screen.getByRole("columnheader", { name: /^Utilisation/ });
    fireEvent.click(header);
    const names = screen.getAllByText(/^Scheme \d$/).map((e) => e.textContent);
    // ascending numeric: 9% (Scheme 2) < 100% (Scheme 3) < 100.3% (Scheme 1); lexical order would put "9%" last.
    expect(names).toEqual(["Scheme 2", "Scheme 3", "Scheme 1"]);
  });
});
