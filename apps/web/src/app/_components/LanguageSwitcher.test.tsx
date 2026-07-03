import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { LocaleProvider } from "@/lib/i18n/LocaleProvider";

// Wrap with LocaleProvider for tests
function renderWithProvider(initialLocale: "en" | "hi" = "en") {
  return render(
    <LocaleProvider initialLocale={initialLocale}>
      <LanguageSwitcher />
    </LocaleProvider>,
  );
}

describe("LanguageSwitcher", () => {
  it("renders the language trigger button", () => {
    renderWithProvider();
    const button = screen.getByRole("button", { name: /language/i });
    expect(button).toBeInTheDocument();
  });

  it("shows English flag when locale is en", () => {
    renderWithProvider("en");
    const button = screen.getByRole("button", { name: /language/i });
    expect(button.textContent).toContain("🇬🇧");
  });

  it("shows Indian flag when locale is hi", () => {
    renderWithProvider("hi");
    const button = screen.getByRole("button", { name: /language/i });
    expect(button.textContent).toContain("🇮🇳");
  });

  it("opens language menu on click", () => {
    renderWithProvider();
    const button = screen.getByRole("button", { name: /language/i });
    fireEvent.click(button);
    expect(screen.getByRole("listbox", { name: /select language/i })).toBeInTheDocument();
  });

  it("shows both language options in the menu", () => {
    renderWithProvider();
    const button = screen.getByRole("button", { name: /language/i });
    fireEvent.click(button);
    expect(screen.getByText("🇬🇧 English")).toBeInTheDocument();
    expect(screen.getByText("🇮🇳 हिन्दी")).toBeInTheDocument();
  });

  it("switches locale to Hindi on select", () => {
    renderWithProvider("en");
    const button = screen.getByRole("button", { name: /language/i });
    fireEvent.click(button);

    const hindiOption = screen.getByText("🇮🇳 हिन्दी");
    fireEvent.click(hindiOption);

    // After switching, the trigger should now show the Indian flag
    const updatedButton = screen.getByRole("button", { name: /language/i });
    expect(updatedButton.textContent).toContain("🇮🇳");
  });

  it("switches locale to English on select", () => {
    renderWithProvider("hi");
    const button = screen.getByRole("button", { name: /language/i });
    fireEvent.click(button);

    const englishOption = screen.getByText("🇬🇧 English");
    fireEvent.click(englishOption);

    const updatedButton = screen.getByRole("button", { name: /language/i });
    expect(updatedButton.textContent).toContain("🇬🇧");
  });

  it("closes menu after selection", () => {
    renderWithProvider();
    const button = screen.getByRole("button", { name: /language/i });
    fireEvent.click(button);

    const hindiOption = screen.getByText("🇮🇳 हिन्दी");
    fireEvent.click(hindiOption);

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("has correct aria-expanded attribute", () => {
    renderWithProvider();
    const button = screen.getByRole("button", { name: /language/i });
    expect(button).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
  });

  it("marks current locale as selected in menu", () => {
    renderWithProvider("en");
    const button = screen.getByRole("button", { name: /language/i });
    fireEvent.click(button);

    const englishOption = screen.getByRole("option", { name: /english/i });
    expect(englishOption).toHaveAttribute("aria-selected", "true");

    const hindiOption = screen.getByRole("option", { name: /हिन्दी/i });
    expect(hindiOption).toHaveAttribute("aria-selected", "false");
  });
});
