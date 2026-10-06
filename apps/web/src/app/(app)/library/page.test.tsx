import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import hiMessages from "@/messages/hi.json";
import LibraryPage from "./page";

function renderAt(locale: "en" | "hi") {
  const messages = locale === "en" ? enMessages : hiMessages;
  return render(
    <NextIntlClientProvider locale={locale} messages={messages}>
      <LibraryPage />
    </NextIntlClientProvider>,
  );
}

describe("LibraryPage", () => {
  // GAP-LIBRARY-HOME-01: the generic name "Library" must not head a page of
  // engineering findings — the title is now "Audit finding types" and the
  // "Library" name is left to /estab/library. Fails on the old "Issue Library".
  it("titles the page 'Audit finding types', not 'Library'", () => {
    renderAt("en");
    expect(screen.getByRole("heading", { name: /audit finding types/i })).toBeInTheDocument();
    expect(screen.queryByText(/issue library/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /^library$/i })).not.toBeInTheDocument();
  });

  // GAP-LIBRARY-HOME-05: a legend explaining the W/I code prefixes is visible,
  // and strings come from next-intl keys. Fails on the old code (no legend).
  it("shows a code legend above the list", () => {
    renderAt("en");
    expect(screen.getByText(/W = web finding/i)).toBeInTheDocument();
    expect(screen.getByText(/I = interaction finding/i)).toBeInTheDocument();
  });

  // GAP-LIBRARY-HOME-05: switching locale changes labels (previously all
  // English literals). The Hindi legend/title differ from English.
  it("renders Hindi labels when the locale is hi", () => {
    renderAt("hi");
    expect(screen.getByText(hiMessages.library.pageTitle)).toBeInTheDocument();
    expect(screen.getByText(hiMessages.library.legend)).toBeInTheDocument();
    expect(screen.getByLabelText(hiMessages.library.searchLabel)).toBeInTheDocument();
  });

  // GAP-LIBRARY-HOME-04: severity swatches use design-system tokens, never raw
  // hex. Assert the border-inline-start uses a var(--...) token and no literal
  // #hex appears in the rendered severity inline styles.
  it("uses CSS design tokens (no raw hex) for severity swatches", () => {
    renderAt("en");
    const list = screen.getByRole("list", { name: enMessages.library.issuesAriaLabel });
    const items = within(list).getAllByRole("listitem");
    expect(items.length).toBeGreaterThan(0);
    for (const li of items) {
      const border = (li as HTMLElement).style.borderInlineStart;
      expect(border).toMatch(/var\(--/);
      expect(border).not.toMatch(/#[0-9a-f]{3,6}/i);
    }
  });

  // Filtering still works and the empty state is localised (HOME-05).
  it("shows the localised empty state when no issue matches the filter", () => {
    renderAt("en");
    fireEvent.change(screen.getByLabelText(enMessages.library.searchLabel), {
      target: { value: "zzzz-no-match-zzzz" },
    });
    expect(screen.getByText(enMessages.library.emptyState)).toBeInTheDocument();
  });

  it("renders a known finding title from the catalogue", () => {
    renderAt("en");
    expect(screen.getByText(enMessages.library.issue_W4_title)).toBeInTheDocument();
  });
});
