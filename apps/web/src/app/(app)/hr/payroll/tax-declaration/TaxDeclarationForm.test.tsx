import { describe, it, expect, vi, afterEach } from "vitest";
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

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/**
 * UX-016: this used to show the raw HTTP status (`Submission failed
 * (${res.status}). Please try again or contact support.`) verbatim — the
 * same class of leak useFormError closes fleet-wide (UX-003).
 */
describe("TaxDeclarationForm — UX-016 clerk-safe errors", () => {
  const fetchMock = vi.fn();
  afterEach(() => vi.unstubAllGlobals());

  it("shows a clerk-safe message, never the raw HTTP status, when submission fails", async () => {
    fetchMock.mockReset();
    fetchMock.mockImplementation((_url: string, init?: RequestInit) => {
      if (!init || init.method === undefined) {
        // Initial GET for the existing declaration — none on file.
        return Promise.resolve(new Response("null", { status: 200 }));
      }
      return Promise.resolve(new Response("", { status: 500 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    renderForm();
    await waitFor(() => expect(screen.getByRole("button", { name: /submit declaration/i })).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /submit declaration/i }));

    await waitFor(() => expect(screen.getByText(/couldn't save/i)).toBeInTheDocument());
    expect(screen.queryByText(/Submission failed/)).not.toBeInTheDocument();
    expect(screen.queryByText(/\b500\b/)).not.toBeInTheDocument();
  });
});

/**
 * GAP-PAYROLL-TAX-DECLARATION-01: a failed load used to leave Submit enabled
 * over a blank form, so one click could silently wipe a filed declaration
 * with zeros. Submit must now stay disabled until a successful (re)load, and
 * Retry must be able to recover without a full page refresh.
 */
describe("TaxDeclarationForm — GAP-PAYROLL-TAX-DECLARATION-01 load-failure guard", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("disables submit and offers Retry when the initial load fails, and Retry recovers", async () => {
    let getCalls = 0;
    const fetchMock = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      if (!init || init.method === undefined) {
        getCalls += 1;
        if (getCalls === 1) return Promise.resolve(new Response("", { status: 500 }));
        return Promise.resolve(jsonResponse({
          regime: "old",
          section80c: 15000000,
          section80d: 0,
          otherDeductions: 0,
          rentPaidMinor: 0,
          prevEmployerSalaryMinor: 0,
          otherSourcesIncomeMinor: 0,
          perquisitesMinor: 0,
          status: "submitted",
          createdAt: "2026-04-15T00:00:00.000Z",
        }));
      }
      throw new Error("save must not be called while the load has failed");
    });
    vi.stubGlobal("fetch", fetchMock);

    renderForm();

    await waitFor(() => expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /submit declaration/i })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: /retry/i }));

    await waitFor(() => expect(screen.getByRole("button", { name: /submit declaration/i })).toBeEnabled());
    expect(screen.queryByRole("button", { name: /retry/i })).not.toBeInTheDocument();
    expect((screen.getByLabelText(/section 80c/i) as HTMLInputElement).value).toBe("150000.00");
  });
});

/**
 * GAP-PAYROLL-TAX-DECLARATION-04: Section 80C/80D/Other Deductions/Rent do
 * not reduce tax under the New Regime but stayed editable; and a stored
 * non-whole-rupee paise amount used to render into a step="1" input,
 * making the (already-valid, already-saved) form un-submittable.
 */
describe("TaxDeclarationForm — GAP-PAYROLL-TAX-DECLARATION-04 regime gating and money precision", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("disables 80C/80D/Other Deductions/Rent under New Regime and re-enables them under Old Regime", async () => {
    const fetchMock = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      if (!init || init.method === undefined) return Promise.resolve(new Response("null", { status: 200 }));
      return Promise.resolve(jsonResponse({ id: "x", status: "accepted" }, 202));
    });
    vi.stubGlobal("fetch", fetchMock);

    renderForm();
    await waitFor(() => expect(screen.getByRole("button", { name: /submit declaration/i })).toBeInTheDocument());

    // Defaults to New Regime -> non-applicable deduction fields start disabled.
    expect(screen.getByLabelText(/section 80c/i)).toBeDisabled();
    expect(screen.getByLabelText(/section 80d/i)).toBeDisabled();
    expect(screen.getByLabelText(/other deductions/i)).toBeDisabled();
    expect(screen.getByLabelText(/rent paid annually/i)).toBeDisabled();
    // Fields that apply under both regimes stay editable.
    expect(screen.getByLabelText(/previous employer salary/i)).toBeEnabled();

    fireEvent.click(screen.getByRole("radio", { name: /old regime/i }));

    expect(screen.getByLabelText(/section 80c/i)).toBeEnabled();
    expect(screen.getByLabelText(/section 80d/i)).toBeEnabled();
    expect(screen.getByLabelText(/other deductions/i)).toBeEnabled();
    expect(screen.getByLabelText(/rent paid annually/i)).toBeEnabled();
  });

  it("prefills a stored non-whole-rupee paise amount into a step=0.01 input instead of a step=1 input", async () => {
    const fetchMock = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      if (!init || init.method === undefined) {
        return Promise.resolve(jsonResponse({
          regime: "old", section80c: 123456, section80d: 0, otherDeductions: 0, rentPaidMinor: 0,
          prevEmployerSalaryMinor: 0, otherSourcesIncomeMinor: 0, perquisitesMinor: 0,
          status: "submitted", createdAt: "2026-04-01T00:00:00.000Z",
        }));
      }
      return Promise.resolve(jsonResponse({ id: "x" }, 202));
    });
    vi.stubGlobal("fetch", fetchMock);

    renderForm();
    await waitFor(() => expect(screen.getByRole("button", { name: /submit declaration/i })).toBeInTheDocument());

    const input = screen.getByLabelText(/section 80c/i) as HTMLInputElement;
    expect(input.value).toBe("1234.56");
    expect(input.step).toBe("0.01");
  });

  it("blocks submit on an amount with more than 2 decimal places and never calls the save endpoint", async () => {
    const fetchMock = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      if (!init || init.method === undefined) return Promise.resolve(new Response("null", { status: 200 }));
      throw new Error("save must not be called for an invalid amount");
    });
    vi.stubGlobal("fetch", fetchMock);

    renderForm();
    await waitFor(() => expect(screen.getByRole("button", { name: /submit declaration/i })).toBeInTheDocument());

    fireEvent.click(screen.getByRole("radio", { name: /old regime/i }));
    fireEvent.change(screen.getByLabelText(/section 80c/i), { target: { value: "150.555" } });
    fireEvent.click(screen.getByRole("button", { name: /submit declaration/i }));

    await waitFor(() => expect(screen.getByText(/valid amount/i)).toBeInTheDocument());
  });
});

/**
 * GAP-PAYROLL-TAX-DECLARATION-05: resubmitting silently replaced any prior
 * declaration with no warning. A confirmation must gate a replace; a
 * first-time filer (no existing declaration) must not be interrupted by it.
 */
describe("TaxDeclarationForm — GAP-PAYROLL-TAX-DECLARATION-05 replace confirmation", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("confirms before replacing an existing declaration and does not save until confirmed", async () => {
    let postCalls = 0;
    const fetchMock = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      if (!init || init.method === undefined) {
        return Promise.resolve(jsonResponse({
          regime: "old", section80c: 0, section80d: 0, otherDeductions: 0, rentPaidMinor: 0,
          prevEmployerSalaryMinor: 0, otherSourcesIncomeMinor: 0, perquisitesMinor: 0,
          status: "submitted", createdAt: "2026-04-01T00:00:00.000Z",
        }));
      }
      postCalls += 1;
      return Promise.resolve(jsonResponse({ id: "x", status: "accepted" }, 202));
    });
    vi.stubGlobal("fetch", fetchMock);

    renderForm();
    await waitFor(() => expect(screen.getByRole("button", { name: /submit declaration/i })).toBeInTheDocument());
    expect(screen.getByText(/filed on/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /submit declaration/i }));

    await waitFor(() => expect(screen.getByRole("alertdialog")).toBeInTheDocument());
    expect(postCalls).toBe(0);

    fireEvent.click(screen.getByRole("button", { name: /yes, replace declaration/i }));

    await waitFor(() => expect(postCalls).toBe(1));
  });

  it("saves directly with no confirmation dialog when no declaration exists yet", async () => {
    let postCalls = 0;
    const fetchMock = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      if (!init || init.method === undefined) return Promise.resolve(new Response("null", { status: 200 }));
      postCalls += 1;
      return Promise.resolve(jsonResponse({ id: "x", status: "accepted" }, 202));
    });
    vi.stubGlobal("fetch", fetchMock);

    renderForm();
    await waitFor(() => expect(screen.getByRole("button", { name: /submit declaration/i })).toBeInTheDocument());
    expect(screen.queryByText(/filed on/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /submit declaration/i }));

    await waitFor(() => expect(postCalls).toBe(1));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });
});
