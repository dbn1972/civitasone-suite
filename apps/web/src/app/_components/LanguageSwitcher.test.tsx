import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { LanguageSwitcher } from "./LanguageSwitcher";
import enMessages from "@/messages/en.json";
import hiMessages from "@/messages/hi.json";

// UX-004: LanguageSwitcher now reads next-intl's useLocale() and switches by
// writing the `locale` cookie + reloading (see component comment) rather
// than the old, never-mounted lib/i18n LocaleProvider.
function renderWithProvider(locale: "en" | "hi" = "en") {
  const messages = locale === "hi" ? hiMessages : enMessages;
  return render(
    <NextIntlClientProvider locale={locale} messages={messages}>
      <LanguageSwitcher />
    </NextIntlClientProvider>,
  );
}

describe("LanguageSwitcher", () => {
  beforeEach(() => {
    document.cookie = "locale=; path=/; max-age=0";
    vi.stubGlobal("location", { ...window.location, reload: vi.fn() });
  });

  it("renders the language trigger button", () => {
    renderWithProvider();
    expect(screen.getByRole("button", { name: /language/i })).toBeInTheDocument();
  });

  it("shows English flag when locale is en", () => {
    renderWithProvider("en");
    expect(screen.getByRole("button", { name: /language/i }).textContent).toContain("🇬🇧");
  });

  it("shows Indian flag when locale is hi", () => {
    renderWithProvider("hi");
    expect(screen.getByRole("button", { name: /language/i }).textContent).toContain("🇮🇳");
  });

  it("opens language menu on click and lists both options", () => {
    renderWithProvider();
    fireEvent.click(screen.getByRole("button", { name: /language/i }));
    expect(screen.getByRole("listbox", { name: /select language/i })).toBeInTheDocument();
    expect(screen.getByText("English")).toBeInTheDocument();
    expect(screen.getByText("हिन्दी")).toBeInTheDocument();
  });

  it("selecting a locale writes the `locale` cookie next-intl's request config reads and reloads", () => {
    renderWithProvider("en");
    fireEvent.click(screen.getByRole("button", { name: /language/i }));
    fireEvent.click(screen.getByText("हिन्दी"));

    expect(document.cookie).toContain("locale=hi");
    expect(window.location.reload).toHaveBeenCalledTimes(1);
  });

  it("does not reload when re-selecting the already-active locale", () => {
    renderWithProvider("en");
    fireEvent.click(screen.getByRole("button", { name: /language/i }));
    fireEvent.click(screen.getByText("English"));

    expect(window.location.reload).not.toHaveBeenCalled();
  });

  it("closes the menu after selection", () => {
    renderWithProvider();
    fireEvent.click(screen.getByRole("button", { name: /language/i }));
    fireEvent.click(screen.getByText("हिन्दी"));
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("marks the current locale as selected in the menu", () => {
    renderWithProvider("en");
    fireEvent.click(screen.getByRole("button", { name: /language/i }));
    expect(screen.getByRole("option", { name: /english/i })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("option", { name: /हिन्दी/i })).toHaveAttribute("aria-selected", "false");
  });
});
