import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import { Form16Wizard } from "./Form16Wizard";

// UX-017: Form16Wizard now reads its copy through next-intl
// (useTranslations("form16Wizard")), so every render needs a real provider
// in the tree -- same pattern as pt/PtSlabForm.test.tsx (tranche 12).
function renderWizard(defaultFy = "2025-26") {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <Form16Wizard defaultFy={defaultFy} />
    </NextIntlClientProvider>,
  );
}

// UX-008 tranche 2: the step-navigation buttons mixed a bare `className="btn"`
// (no variant -- unstyled beyond the box model) with a proper `"btn ghost"`;
// both converted onto the shared Button component. No prior test existed for
// this file, so this covers step navigation and the generate action.
describe("Form16Wizard", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("advances from step 0 to step 1 and back via Next/Back", () => {
    renderWizard();
    expect(screen.getByText("Financial Year")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Next: Review Deductions/ }));
    expect(screen.getByText(/Deduction Figures/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "← Back" }));
    expect(screen.getByText("Financial Year")).toBeInTheDocument();
  });

  it("generates Form 16 and advances to the download step", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ data: { jobId: "job-123" } }), { status: 200 }),
    );
    renderWizard();
    fireEvent.click(screen.getByRole("button", { name: /Next: Review Deductions/ }));
    fireEvent.click(screen.getByRole("button", { name: /Generate Form 16/ }));

    await waitFor(() => expect(screen.getByText("Form-16 generation started")).toBeInTheDocument());
    expect(screen.getByText("Job ID: job-123")).toBeInTheDocument();
  });

  it("shows an error and stays on step 1 when generation fails", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: { message: "FY not closed yet." } }), { status: 422 }),
    );
    renderWizard();
    fireEvent.click(screen.getByRole("button", { name: /Next: Review Deductions/ }));
    fireEvent.click(screen.getByRole("button", { name: /Generate Form 16/ }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("FY not closed yet."));
    expect(screen.getByText(/Deduction Figures/)).toBeInTheDocument();
  });

  // HIGH-7 (a11y remediation): no focus management or step-change
  // announcement existed across Next/Back — StepBar visually marked
  // aria-current="step" but nothing moved focus or told a screen reader
  // the step changed. These cover the fix, not just that the step content
  // itself swaps (already covered above).
  describe("step-change focus management and announcement", () => {
    it("does not steal focus on initial mount", () => {
      renderWizard();
      expect(document.activeElement).not.toHaveAttribute("role", "group");
    });

    it("moves focus to the new step's panel when Next is clicked", () => {
      renderWizard();
      fireEvent.click(screen.getByRole("button", { name: /Next: Review Deductions/ }));
      const panel = screen.getByRole("group", { name: "Review Deductions" });
      expect(document.activeElement).toBe(panel);
      expect(panel).toHaveAttribute("tabindex", "-1");
    });

    it("moves focus back to step 0's panel when Back is clicked", () => {
      renderWizard();
      fireEvent.click(screen.getByRole("button", { name: /Next: Review Deductions/ }));
      fireEvent.click(screen.getByRole("button", { name: "← Back" }));
      expect(document.activeElement).toBe(screen.getByRole("group", { name: "Select FY" }));
    });

    it("announces the new step via a polite live region", () => {
      renderWizard();
      fireEvent.click(screen.getByRole("button", { name: /Next: Review Deductions/ }));
      const live = document.querySelector('[aria-live="polite"]');
      expect(live).not.toBeNull();
      expect(live).toHaveTextContent("Step 2 of 3: Review Deductions");
    });
  });
});
