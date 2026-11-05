import { describe, it, expect, beforeAll } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import hiMessages from "@/messages/hi.json";
import { AskCivitasOne, AskCivitasOneTrigger } from "./AskCivitasOne";

beforeAll(() => {
  // jsdom has no scrollIntoView; the panel scrolls its message list on open.
  Element.prototype.scrollIntoView = () => {};
});

/** UAT-P3 (DS-3 / DS-10): Ask is a header button; the floating trigger that covered content is gone. */
function renderAsk(locale: "en" | "hi" = "en") {
  return render(
    <NextIntlClientProvider locale={locale} messages={locale === "hi" ? hiMessages : enMessages}>
      <header><AskCivitasOneTrigger /></header>
      <AskCivitasOne />
    </NextIntlClientProvider>,
  );
}

describe("Ask CivitasOne in the top bar", () => {
  it("the host renders nothing floating until the header button is pressed", () => {
    const { container } = renderAsk();
    const fixed = Array.from(container.querySelectorAll<HTMLElement>("*")).filter((el) => el.style.position === "fixed");
    expect(fixed).toEqual([]);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens the panel from the header and returns focus to it on close", () => {
    renderAsk();
    const trigger = screen.getByRole("button", { name: "Ask CivitasOne" });
    fireEvent.click(trigger);
    expect(screen.getByRole("dialog", { name: "Ask CivitasOne" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close assistant" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("is labelled in Hindi", () => {
    renderAsk("hi");
    const trigger = screen.getByRole("button", { name: "CivitasOne से पूछें" });
    expect(trigger).toHaveTextContent("पूछें");
  });
});
