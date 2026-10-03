import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
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
