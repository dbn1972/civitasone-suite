import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import { TaxDeclarationForm } from "./TaxDeclarationForm";

// UX-017: TaxDeclarationForm now reads its copy through next-intl
// (useTranslations("taxDeclarationForm")), so every render needs a real
// provider in the tree -- same pattern as pt/PtSlabForm.test.tsx (tranche 12).
function renderForm() {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <TaxDeclarationForm />
    </NextIntlClientProvider>,
  );
}

/**
 * UX-016: this used to show the raw HTTP status (`Submission failed
 * (${res.status}). Please try again or contact support.`) verbatim — the
 * same class of leak useFormError closes fleet-wide (UX-003).
 */
describe("TaxDeclarationForm — UX-016 clerk-safe errors", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (!init || init.method === undefined) {
        // Initial GET for the existing declaration — none on file.
        return Promise.resolve(new Response("null", { status: 200 }));
      }
      return Promise.resolve(new Response("", { status: 500 }));
    });
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("shows a clerk-safe message, never the raw HTTP status, when submission fails", async () => {
    renderForm();
    await waitFor(() => expect(screen.getByRole("button", { name: /submit declaration/i })).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /submit declaration/i }));

    await waitFor(() => expect(screen.getByText(/couldn't save/i)).toBeInTheDocument());
    expect(screen.queryByText(/Submission failed/)).not.toBeInTheDocument();
    expect(screen.queryByText(/\b500\b/)).not.toBeInTheDocument();
  });
});
