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

/**
 * GAP-PAYROLL-TAX-DECLARATION-02/04/05: landlord PAN, effective caps, window.
 * Routes by URL so the form's three GETs (declaration, limits, window) each
 * get their own answer.
 */
function routeFetch(opts: { declaration?: unknown; limits?: unknown; window?: unknown } = {}) {
  const posts: Array<Record<string, unknown>> = [];
  const spy = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      posts.push(JSON.parse(String(init.body)));
      return Promise.resolve(jsonResponse({ id: "d1", status: "accepted" }, 202));
    }
    if (String(url).includes("/tax-declarations/limits")) {
      return Promise.resolve(opts.limits === undefined ? new Response("", { status: 500 }) : jsonResponse(opts.limits));
    }
    if (String(url).includes("/tax-declarations/window")) {
      return Promise.resolve(opts.window === undefined ? new Response("", { status: 500 }) : jsonResponse(opts.window));
    }
    return Promise.resolve(opts.declaration === undefined ? new Response("null", { status: 200 }) : jsonResponse(opts.declaration));
  });
  vi.stubGlobal("fetch", spy);
  return { posts, spy };
}

const LIMITS = { fy: "2025-26", sec80cCapMinor: "15000000", sec80dCapMinor: "7500000", sec80ccd1bCapMinor: "5000000", landlordPanRentThresholdMinor: "10000000" };

async function readyForm() {
  renderForm();
  await waitFor(() => expect(screen.getByRole("button", { name: /submit declaration/i })).toBeInTheDocument());
}

describe("TaxDeclarationForm -- GAP-PAYROLL-TAX-DECLARATION-04 effective caps", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("blocks an 80C amount above the tenant's EFFECTIVE cap (old regime) without posting, quoting that cap", async () => {
    const { posts } = routeFetch({ limits: { ...LIMITS, sec80cCapMinor: "20000000" } });
    await readyForm();
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledWith(expect.stringContaining("/tax-declarations/limits"), expect.anything()));
    fireEvent.click(screen.getByLabelText(/old regime/i));
    fireEvent.change(screen.getByLabelText(/80C/), { target: { value: "250000" } });
    fireEvent.click(screen.getByRole("button", { name: /submit declaration/i }));
    await waitFor(() => expect(screen.getByText(/Section 80C is limited to ₹2,00,000.00/)).toBeInTheDocument());
    expect(posts).toHaveLength(0);
  });

  it("allows an amount at the cap, and an over-cap 80C under the NEW regime is not checked (field is disabled anyway)", async () => {
    const { posts } = routeFetch({ limits: LIMITS });
    await readyForm();
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledWith(expect.stringContaining("/tax-declarations/limits"), expect.anything()));
    fireEvent.click(screen.getByLabelText(/old regime/i));
    fireEvent.change(screen.getByLabelText(/80C/), { target: { value: "150000" } });
    fireEvent.click(screen.getByRole("button", { name: /submit declaration/i }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toMatchObject({ regime: "old", section80c: 15000000 });
  });

  it("when the caps cannot be loaded there is no client-side limit check (the server stays the gate)", async () => {
    const { posts } = routeFetch();
    await readyForm();
    fireEvent.click(screen.getByLabelText(/old regime/i));
    fireEvent.change(screen.getByLabelText(/80C/), { target: { value: "999999" } });
    fireEvent.click(screen.getByRole("button", { name: /submit declaration/i }));
    await waitFor(() => expect(posts).toHaveLength(1));
  });
});

describe("TaxDeclarationForm -- GAP-PAYROLL-TAX-DECLARATION-02 landlord PAN", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("rent above Rs 1,00,000 (old regime) shows the landlord fields and blocks submit without a PAN", async () => {
    const { posts } = routeFetch({ limits: LIMITS });
    await readyForm();
    fireEvent.click(screen.getByLabelText(/old regime/i));
    expect(screen.queryByLabelText(/Landlord PAN/)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/rent/i), { target: { value: "120000" } });
    expect(screen.getByLabelText(/Landlord PAN/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /submit declaration/i }));
    await waitFor(() => expect(screen.getByText(/Enter the landlord's PAN/)).toBeInTheDocument());
    expect(posts).toHaveLength(0);
  });

  it("rejects a malformed PAN, then posts an upper-cased valid one with the landlord name", async () => {
    const { posts } = routeFetch({ limits: LIMITS });
    await readyForm();
    fireEvent.click(screen.getByLabelText(/old regime/i));
    fireEvent.change(screen.getByLabelText(/rent/i), { target: { value: "120000" } });
    fireEvent.change(screen.getByLabelText(/Landlord PAN/), { target: { value: "bad-pan" } });
    fireEvent.click(screen.getByRole("button", { name: /submit declaration/i }));
    await waitFor(() => expect(screen.getByText(/landlord PAN is not valid/)).toBeInTheDocument());
    expect(posts).toHaveLength(0);
    fireEvent.change(screen.getByLabelText(/Landlord PAN/), { target: { value: "abcde1234f" } });
    fireEvent.change(screen.getByLabelText(/Landlord name/), { target: { value: "A Landlord" } });
    fireEvent.click(screen.getByRole("button", { name: /submit declaration/i }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toMatchObject({ landlordPan: "ABCDE1234F", landlordName: "A Landlord", rentPaidMinor: 12000000 });
  });

  it("a PAN already on file (masked) is not required again and is not sent when left blank", async () => {
    const { posts } = routeFetch({
      limits: LIMITS,
      declaration: { regime: "old", section80c: 0, section80d: 0, otherDeductions: 0, rentPaidMinor: 12000000, status: "submitted", createdAt: "2026-04-15T00:00:00.000Z", updatedAt: "2026-05-01T00:00:00.000Z", landlordName: "A Landlord", landlordPanMasked: "ABCDE****F" },
    });
    renderForm();
    await waitFor(() => expect(screen.getByText(/PAN on file: ABCDE\*\*\*\*F/)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /submit declaration/i }));
    fireEvent.click(await screen.findByRole("button", { name: /replace/i }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).not.toHaveProperty("landlordPan");
  });
});

describe("TaxDeclarationForm -- GAP-PAYROLL-TAX-DECLARATION-05 window and last updated", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("a closed window shows the date and disables submit", async () => {
    routeFetch({ window: { fy: "2025-26", configured: true, open: false, state: "closed", opensOn: null, closesOn: "2026-01-31" } });
    await readyForm();
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/closed on/i));
    expect(screen.getByRole("button", { name: /submit declaration/i })).toBeDisabled();
  });

  it("an open window shows the deadline and leaves submit enabled", async () => {
    routeFetch({ window: { fy: "2025-26", configured: true, open: true, state: "open", opensOn: null, closesOn: "2099-12-31" } });
    await readyForm();
    await waitFor(() => expect(screen.getByText(/Declarations are open until/)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /submit declaration/i })).toBeEnabled();
  });

  it("shows 'Last updated' next to the filed-on date for an existing declaration", async () => {
    routeFetch({ declaration: { regime: "new", section80c: 0, section80d: 0, otherDeductions: 0, rentPaidMinor: 0, status: "submitted", createdAt: "2026-04-15T00:00:00.000Z", updatedAt: "2026-06-20T00:00:00.000Z" } });
    renderForm();
    await waitFor(() => expect(screen.getByText(/Last updated/)).toBeInTheDocument());
    expect(screen.getByText(/Filed on/)).toBeInTheDocument();
  });
});
