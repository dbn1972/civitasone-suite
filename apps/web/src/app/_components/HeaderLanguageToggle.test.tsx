import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { HeaderLanguageToggle } from "./HeaderLanguageToggle";
import enMessages from "@/messages/en.json";
import hiMessages from "@/messages/hi.json";

/** PR #2461 review SHOULD-FIX 3: the toggle has a compact form for phones (GIGW 3.0). */
describe("HeaderLanguageToggle compact form", () => {
  it("offers Hindi from English with a full label and a compact अ", () => {
    const { container } = render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <HeaderLanguageToggle />
      </NextIntlClientProvider>,
    );
    const btn = screen.getByRole("button");
    expect(btn).toHaveClass("tb-lang");
    expect(container.querySelector(".tb-lang-long")).toHaveTextContent("हिन्दी");
    expect(container.querySelector(".tb-lang-short")).toHaveTextContent("अ");
    expect(container.querySelector(".tb-lang-short")).toHaveAttribute("aria-hidden", "true");
    expect(btn).toHaveAccessibleName(/हिन्दी/);
  });

  it("offers English from Hindi with a compact A", () => {
    const { container } = render(
      <NextIntlClientProvider locale="hi" messages={hiMessages}>
        <HeaderLanguageToggle />
      </NextIntlClientProvider>,
    );
    expect(container.querySelector(".tb-lang-short")).toHaveTextContent("A");
    expect(container.querySelector(".tb-lang-long")).toHaveTextContent("English");
  });
});
