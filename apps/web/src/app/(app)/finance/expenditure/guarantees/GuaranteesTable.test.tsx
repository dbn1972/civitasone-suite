import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { afterEach } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), usePathname: () => "/", useSearchParams: () => new URLSearchParams() }));

import { GuaranteesTable } from "./GuaranteesTable";

const g = (id: string, type: string, status: string) => ({
  id, entity: `Entity ${id}`, type, amountMinor: "100000", currency: "INR", feePct: "0.5", status,
  createdAt: "2026-04-01T00:00:00.000Z", updatedAt: "2026-04-01T00:00:00.000Z", version: 1,
});

// GAP-FINANCE-EXPENDITURE-GUARANTEES-05
describe("GuaranteesTable type / status wording", () => {
  it("humanizes the type column (acronyms and snake_case)", () => {
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <GuaranteesTable guarantees={[g("1", "bg", "active"), g("2", "pbg", "active"), g("3", "performance", "active"), g("4", "emd", "active")]} />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText("BG")).toBeInTheDocument();
    expect(screen.getByText("PBG")).toBeInTheDocument();
    expect(screen.getByText("Performance")).toBeInTheDocument();
    expect(screen.getByText("EMD")).toBeInTheDocument();
  });

  it("gives the DB's real release statuses a pill tone instead of the neutral fallback", () => {
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <GuaranteesTable guarantees={[g("1", "bg", "partially_released"), g("2", "bg", "fully_released")]} />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText("Partially Released")).toHaveClass("warn");
    expect(screen.getByText("Fully Released")).toHaveClass("mut");
  });
});

// GAP-FINANCE-EXPENDITURE-GUARANTEES-02
describe("GuaranteesTable validity, beneficiary and linked reference", () => {
  afterEach(() => vi.useRealTimers());
  const withValidity = (id: string, status: string, validUntil: string | null) => ({
    ...g(id, "pbg", status), validUntil, beneficiary: id === "1" ? "Public Works Department" : null, linkedRef: id === "1" ? "CON/2031/0042" : null,
  });
  it("shows valid-until, beneficiary and linked bill/contract; flags lapsed and expiring in TEXT; a row with no date is a dash", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-02T06:00:00.000Z"));
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <GuaranteesTable guarantees={[
          withValidity("1", "active", "2026-10-12"),
          withValidity("2", "active", "2026-09-01"),
          withValidity("3", "active", "2027-06-30"),
          withValidity("4", "active", null),
          withValidity("5", "fully_released", "2026-09-01"),
        ]} />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText("12 Oct 2026")).toBeInTheDocument();
    expect(screen.getByText("Public Works Department")).toBeInTheDocument();
    expect(screen.getByText("CON/2031/0042")).toBeInTheDocument();
    expect(screen.getByText("Expiring soon")).toHaveClass("warn");
    expect(screen.getByText("Lapsed")).toHaveClass("bad");
    expect(screen.getAllByText("Valid")).toHaveLength(1);
    for (const col of ["Valid until", "Validity", "Beneficiary", "Linked bill / contract"]) {
      expect(screen.getByRole("columnheader", { name: new RegExp(col) })).toBeInTheDocument();
    }
  });
});
