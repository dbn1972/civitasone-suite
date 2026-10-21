import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import hiMessages from "@/messages/hi.json";
import { EmiProgressCell, emiProgressPercent } from "./EmiProgressCell";

describe("emiProgressPercent (GAP-HR-LOANS-03)", () => {
  it("3 of 12 is 25%", () => expect(emiProgressPercent(3, 12)).toBe(25));
  it("rounds to a whole percent", () => expect(emiProgressPercent(1, 3)).toBe(33));
  it("totalEmis 0 has no percentage (no division by zero)", () => {
    expect(emiProgressPercent(0, 0)).toBeNull();
    expect(emiProgressPercent(5, 0)).toBeNull();
  });
  it("non-finite input has no percentage", () => {
    expect(emiProgressPercent(Number.NaN, 12)).toBeNull();
    expect(emiProgressPercent(3, Number.NaN)).toBeNull();
  });
  it("is clamped to 0-100", () => {
    expect(emiProgressPercent(15, 12)).toBe(100);
    expect(emiProgressPercent(-1, 12)).toBe(0);
  });
});

describe("EmiProgressCell", () => {
  function renderCell(paid: number, total: number, locale: "en" | "hi" = "en") {
    return render(
      <NextIntlClientProvider locale={locale} messages={locale === "hi" ? hiMessages : enMessages}>
        <EmiProgressCell paid={paid} total={total} />
      </NextIntlClientProvider>,
    );
  }

  it("3 of 12 shows '3 / 12' and a 25% progress bar with an accessible name", () => {
    renderCell(3, 12);
    expect(screen.getByText("3 / 12")).toBeInTheDocument();
    const bar = screen.getByRole("progressbar", { name: "3 of 12 EMIs paid" });
    expect(bar).toHaveAttribute("aria-valuenow", "25");
    expect(bar).toHaveAttribute("aria-valuemin", "0");
    expect(bar).toHaveAttribute("aria-valuemax", "100");
  });

  it("totalEmis 0 renders a dash and no bar (and no NaN)", () => {
    const { container } = renderCell(0, 0);
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(container.textContent).not.toMatch(/NaN|Infinity/);
  });

  it("the progress bar's accessible name is localised", () => {
    renderCell(3, 12, "hi");
    expect(screen.getByRole("progressbar", { name: "12 में से 3 ईएमआई चुकाई गईं" })).toHaveAttribute("aria-valuenow", "25");
  });
});
