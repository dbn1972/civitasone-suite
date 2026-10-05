/**
 * GAP-CRM-VOICE-OF-CUSTOMER-03 — the Tone column must carry a colour signal.
 * Before the fix, toneOf returned "Needs attention"/"Watch"/"Healthy", none of
 * which are keys in the shared StatusPill STATUS_MAP, so every row fell back to
 * the same neutral "info" blue — a 64% negative theme looked identical to a 7%
 * one. toneOf now returns an explicit pill variant (bad/warn/good) so the three
 * bands render in three distinct colours.
 */
import { describe, it, expect } from "vitest";
import { render as rtlRender, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import { ThemeTable, toneOf } from "./ThemeTable";
import type { RankedTheme } from "./voc";

function render(ui: React.ReactElement) {
  return rtlRender(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("toneOf — negative-share bands map to distinct pill variants", () => {
  it("maps a mostly-negative theme (>=60%) to the 'bad' variant", () => {
    expect(toneOf(64)).toEqual({ variant: "bad", label: "Needs attention" });
    expect(toneOf(60)).toEqual({ variant: "bad", label: "Needs attention" });
  });

  it("maps a middling theme (30-59%) to the 'warn' variant", () => {
    expect(toneOf(35)).toEqual({ variant: "warn", label: "Watch" });
    expect(toneOf(30)).toEqual({ variant: "warn", label: "Watch" });
  });

  it("maps a low-negative theme (<30%) to the 'good' variant", () => {
    expect(toneOf(7)).toEqual({ variant: "good", label: "Healthy" });
    expect(toneOf(0)).toEqual({ variant: "good", label: "Healthy" });
  });
});

describe("ThemeTable — the Tone pill renders a distinct colour class per band", () => {
  function theme(over: Partial<RankedTheme>): RankedTheme {
    return { theme: "delay", count: 10, negativeCount: 0, sharePct: 10, negativePct: 0, ...over };
  }

  it("renders bad / warn / good pill classes for 64 / 35 / 7 percent", () => {
    const themes: RankedTheme[] = [
      theme({ theme: "delay", negativePct: 64 }),
      theme({ theme: "billing", negativePct: 35 }),
      theme({ theme: "accessibility", negativePct: 7 }),
    ];
    const { container } = render(<ThemeTable themes={themes} />);

    // The three tone pills must not all share one class — they used to all be "info".
    expect(container.querySelector(".pill.bad")).not.toBeNull();
    expect(container.querySelector(".pill.warn")).not.toBeNull();
    expect(container.querySelector(".pill.good")).not.toBeNull();
    // And none should fall back to the neutral info blue.
    expect(container.querySelector(".pill.info")).toBeNull();

    expect(screen.getByText("Needs attention")).toBeInTheDocument();
    expect(screen.getByText("Watch")).toBeInTheDocument();
    expect(screen.getByText("Healthy")).toBeInTheDocument();
  });
});
