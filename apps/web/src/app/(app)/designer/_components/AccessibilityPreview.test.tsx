import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { AccessibilityPreview } from "./AccessibilityPreview";
import type { A11yPreviewDto } from "../_data/designerApi";

const fetchA11yPreview = vi.fn();
vi.mock("../_data/designerApi", () => ({
  fetchA11yPreview: (id: string) => fetchA11yPreview(id) as Promise<A11yPreviewDto>,
}));

afterEach(() => {
  fetchA11yPreview.mockReset();
});

function preview(over: Partial<A11yPreviewDto> = {}): A11yPreviewDto {
  return {
    formAuthored: true,
    passed: true,
    issues: [],
    errorCount: 0,
    warningCount: 0,
    ...over,
  };
}

describe("FN-32 AccessibilityPreview", () => {
  it("BRD acceptance: a missing label is listed with the field and what to do", () => {
    fetchA11yPreview.mockResolvedValue(preview({
      passed: false,
      errorCount: 1,
      issues: [{
        code: "FIELD_MISSING_LABEL",
        severity: "error",
        wcag: "3.3.2 Labels or Instructions",
        fieldId: "hb-f4",
        message: 'Field "purpose" has no label. Add a visible label — a placeholder is not announced by screen readers.',
      }],
    }));

    render(<AccessibilityPreview definitionId="def-1" />);

    return waitFor(() => {
      // The actionable text, not just a verdict.
      expect(screen.getByText(/has no label/i)).toBeTruthy();
      expect(screen.getByText(/Add a visible label/i)).toBeTruthy();
      // Which field, and which criterion to look up.
      expect(screen.getByText(/hb-f4/)).toBeTruthy();
      expect(screen.getByText(/3\.3\.2/)).toBeTruthy();
      expect(screen.getByText("1 to fix")).toBeTruthy();
    });
  });

  it("separates blocking errors from recommendations", () => {
    // Warnings must not read as blockers: a GIGW bilingual gap should not stop a
    // correct English-first pilot.
    fetchA11yPreview.mockResolvedValue(preview({
      passed: true,
      warningCount: 1,
      issues: [{
        code: "GIGW_SECONDARY_LOCALE_MISSING",
        severity: "warning",
        wcag: "GIGW 3.0 — bilingual content",
        message: "Only \"en\" is declared. GIGW expects a second language.",
      }],
    }));

    render(<AccessibilityPreview definitionId="def-1" />);

    return waitFor(() => {
      expect(screen.getByText("Recommended")).toBeTruthy();
      expect(screen.queryByText("Must fix before publishing")).toBeNull();
      expect(screen.getByText("Passes")).toBeTruthy();
    });
  });

  it("confirms a clean form rather than showing an empty panel", () => {
    fetchA11yPreview.mockResolvedValue(preview());
    render(<AccessibilityPreview definitionId="def-1" />);
    return waitFor(() => {
      expect(screen.getByText("Passes")).toBeTruthy();
      expect(screen.getByText(/Every field has a label/i)).toBeTruthy();
    });
  });

  it("distinguishes 'no form authored' from a passing form", () => {
    fetchA11yPreview.mockResolvedValue(preview({
      formAuthored: false,
      passed: false,
      reason: "No form has been authored for this service yet, so there is nothing to check.",
    }));

    render(<AccessibilityPreview definitionId="def-1" />);

    return waitFor(() => {
      expect(screen.getByText("No form yet")).toBeTruthy();
      expect(screen.getByText(/nothing to check/i)).toBeTruthy();
    });
  });

  it("says so when the check could not run", () => {
    // Silence here would be read as "no problems found", which is the one thing
    // a failed check must never imply.
    fetchA11yPreview.mockRejectedValue(new Error("Could not run the accessibility preview (503)."));

    render(<AccessibilityPreview definitionId="def-1" />);

    return waitFor(() => {
      expect(screen.getByRole("status").textContent).toMatch(/Could not run/i);
      expect(screen.queryByText("Passes")).toBeNull();
    });
  });

  it("states that contrast is not covered, so a pass is not read as full sign-off", () => {
    fetchA11yPreview.mockResolvedValue(preview());
    render(<AccessibilityPreview definitionId="def-1" />);
    return waitFor(() => {
      expect(screen.getByText(/contrast/i).textContent).toMatch(/checked at runtime/i);
    });
  });
});
