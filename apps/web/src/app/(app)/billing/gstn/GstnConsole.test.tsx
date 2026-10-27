import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

import { GstnConsole } from "./GstnConsole";

const VALID_GSTIN = "27AAPFU0939F1ZV"; // checksum-valid
const VALID_GSTIN_2 = "07AAAAA0000A1Z4"; // checksum-valid for state 07

/** The active (visible) panel: inactive panels are present but `hidden`. */
function visiblePanel(container: HTMLElement, selector: string): HTMLElement | null {
  const nodes = Array.from(container.querySelectorAll<HTMLElement>(selector));
  return nodes.find((n) => !n.closest("[hidden]")) ?? null;
}

/** The calls that actually FILE something. GAP-BILLING-GSTN-05 adds a read-only GET history lookup at review. */
function filings(spy: { mock: { calls: unknown[][] } }): unknown[][] {
  return spy.mock.calls.filter((c) => ((c[1] as RequestInit | undefined)?.method ?? "GET") === "POST");
}

function lastButtonNamed(name: string): HTMLElement {
  const matches = screen.getAllByRole("button", { name });
  return matches[matches.length - 1];
}

function submitPanel(): HTMLElement {
  return screen.getByLabelText("Submit GST return") as HTMLElement;
}

function fillSubmitForm() {
  const p = within(submitPanel());
  fireEvent.change(p.getByLabelText(/^GSTIN/), { target: { value: VALID_GSTIN } });
  fireEvent.change(p.getByLabelText(/^Return Period/), { target: { value: "04/2026" } });
  fireEvent.change(p.getByLabelText(/^Total Taxable Value/), { target: { value: "12500000" } });
  fireEvent.change(p.getByLabelText(/^Total CGST/), { target: { value: "1125000" } });
  fireEvent.change(p.getByLabelText(/^Total SGST/), { target: { value: "1125000" } });
  fireEvent.change(p.getByLabelText(/^Total IGST/), { target: { value: "0" } });
}

describe("GstnConsole", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("validates required fields before submitting a GST return", () => {
    render(<GstnConsole />);
    fireEvent.click(screen.getByRole("button", { name: "Submit Return" }));
    expect(within(submitPanel()).getByText(/Enter a valid 15-character GSTIN/)).toBeInTheDocument();
  });

  // GAP-BILLING-GSTN-06: structurally-valid but checksum-invalid GSTIN is rejected.
  it("rejects a GSTIN with a valid structure but a wrong checksum", () => {
    render(<GstnConsole />);
    fireEvent.change(within(submitPanel()).getByLabelText(/^GSTIN/), { target: { value: "27AAPFU0939F1ZX" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit Return" }));
    expect(within(submitPanel()).getByText(/Enter a valid 15-character GSTIN/)).toBeInTheDocument();
  });

  // GAP-BILLING-GSTN-01: a confirm/review step gates the POST.
  it("opens a review dialog with a money summary and only POSTs after confirm", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          data: { referenceId: "ref-1", status: "submitted", gstin: VALID_GSTIN, returnPeriod: "04/2026", submittedAt: "2026-08-01T00:00:00Z" },
        }),
        { status: 201 },
      ),
    );

    render(<GstnConsole />);
    fillSubmitForm();
    fireEvent.click(screen.getByRole("button", { name: "Submit Return" }));

    // dialog shown, nothing POSTed yet
    await waitFor(() => expect(screen.getByText(/File GSTR1 for 04\/2026\?/)).toBeInTheDocument());
    expect(filings(fetchSpy)).toHaveLength(0);
    // GAP-BILLING-GSTN-02: taxable value entered as 12500000 rupees -> ₹ summary
    expect(screen.getAllByText("₹1,25,00,000.00").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "File return" }));
    await waitFor(() => expect(screen.getByText("ref-1")).toBeInTheDocument());
    expect(filings(fetchSpy)).toHaveLength(1);
  });

  // GAP-BILLING-GSTN-02: rupees are converted to a paise string in the payload.
  it("submits rupee entries as paise strings (12500000 rupees -> 1250000000 paise)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ data: { referenceId: "ref-2", status: "submitted", gstin: VALID_GSTIN, returnPeriod: "04/2026", submittedAt: "x" } }),
        { status: 201 },
      ),
    );
    render(<GstnConsole />);
    fillSubmitForm();
    fireEvent.click(screen.getByRole("button", { name: "Submit Return" }));
    await waitFor(() => expect(screen.getByText(/File GSTR1/)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "File return" }));
    await waitFor(() => expect(filings(fetchSpy)).toHaveLength(1));
    const body = JSON.parse((filings(fetchSpy)[0][1] as RequestInit).body as string);
    expect(body.totalTaxableValue).toBe("1250000000");
    expect(body.totalCgst).toBe("112500000");
    expect(body.totalIgst).toBe("0");
    // GAP-BILLING-GSTN-01: an idempotency key is sent.
    const headers = (filings(fetchSpy)[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers["x-idempotency-key"]).toBeTruthy();
  });

  it("rejects a rupee amount with more than 2 decimals", () => {
    render(<GstnConsole />);
    const p = within(submitPanel());
    fireEvent.change(p.getByLabelText(/^GSTIN/), { target: { value: VALID_GSTIN } });
    fireEvent.change(p.getByLabelText(/^Return Period/), { target: { value: "04/2026" } });
    fireEvent.change(p.getByLabelText(/^Total Taxable Value/), { target: { value: "1.234" } });
    fireEvent.change(p.getByLabelText(/^Total CGST/), { target: { value: "0" } });
    fireEvent.change(p.getByLabelText(/^Total SGST/), { target: { value: "0" } });
    fireEvent.change(p.getByLabelText(/^Total IGST/), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit Return" }));
    expect(p.getByText(/at most 2 decimal places|in rupees/)).toBeInTheDocument();
    // no dialog
    expect(screen.queryByText(/File GSTR1/)).not.toBeInTheDocument();
  });

  // GAP-BILLING-GSTN-04: switching tabs keeps the half-typed return (panels stay mounted).
  it("retains typed Submit Return values when switching tabs and back", () => {
    const { container } = render(<GstnConsole />);
    const gstinInput = within(submitPanel()).getByLabelText(/^GSTIN/) as HTMLInputElement;
    fireEvent.change(gstinInput, { target: { value: VALID_GSTIN } });

    fireEvent.click(screen.getByRole("tab", { name: "Verify GSTIN" }));
    // Submit panel is hidden, not unmounted.
    const submitForm = container.querySelector('[aria-label="Submit GST return"]');
    expect(submitForm).toBeInTheDocument();
    expect(submitForm?.closest("[hidden]")).not.toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: "Submit Return" }));
    expect((within(submitPanel()).getByLabelText(/^GSTIN/) as HTMLInputElement).value).toBe(VALID_GSTIN);
  });

  // GAP-BILLING-GSTN-04: a submitted reference id is carried to Return Status.
  it("carries the reference id to the Return Status tab via 'Check status'", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ data: { referenceId: "ref-carry", status: "submitted", gstin: VALID_GSTIN, returnPeriod: "04/2026", submittedAt: "x" } }),
        { status: 201 },
      ),
    );
    const { container } = render(<GstnConsole />);
    fillSubmitForm();
    fireEvent.click(screen.getByRole("button", { name: "Submit Return" }));
    await waitFor(() => expect(screen.getByText(/File GSTR1/)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "File return" }));
    await waitFor(() => expect(screen.getByText("ref-carry")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /Check status/ }));
    // Return Status panel is now active with the ref prefilled.
    const statusForm = visiblePanel(container, '[aria-label="Check GST return status"]');
    expect(statusForm).not.toBeNull();
    const refInput = within(statusForm as HTMLElement).getByLabelText(/^Return Reference ID/) as HTMLInputElement;
    expect(refInput.value).toBe("ref-carry");
  });

  // UX-020 (restored): a failed filing shows a clerk-safe message, never the raw code.
  it("surfaces a clerk-safe message on failure, never the server's raw INTEGRATION_DISABLED code (UX-020)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ error: { code: "INTEGRATION_DISABLED", message: "GSTN integration is not available" } }),
        { status: 503 },
      ),
    );

    render(<GstnConsole />);
    fillSubmitForm();
    fireEvent.click(screen.getByRole("button", { name: "Submit Return" }));
    await waitFor(() => expect(screen.getByText(/File GSTR1/)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "File return" }));

    await waitFor(() => {
      expect(screen.getByText(/couldn't save/i)).toBeInTheDocument();
    });
    expect(screen.queryByText(/INTEGRATION_DISABLED/)).not.toBeInTheDocument();
    expect(screen.queryByText(/INTEGRATION_DISABLED: GSTN integration is not available/)).not.toBeInTheDocument();
  });

  it("switches to Verify GSTIN and verifies a checksum-valid GSTIN", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          data: { gstin: VALID_GSTIN_2, legalName: "Example Pvt Ltd", tradeName: "Example", status: "active", registrationDate: "2020-01-01", lastUpdated: "2026-08-01" },
        }),
        { status: 200 },
      ),
    );

    render(<GstnConsole />);
    fireEvent.click(screen.getByRole("tab", { name: "Verify GSTIN" }));
    const verifyGstin = screen.getAllByLabelText(/^GSTIN/).find((el) => !el.closest("[hidden]"))!;
    fireEvent.change(verifyGstin, { target: { value: VALID_GSTIN_2 } });
    fireEvent.click(lastButtonNamed("Verify GSTIN"));

    await waitFor(() => expect(screen.getByText("Example Pvt Ltd")).toBeInTheDocument());
  });

  it("rejects a checksum-invalid GSTIN on the Verify GSTIN tab", () => {
    const { container } = render(<GstnConsole />);
    fireEvent.click(screen.getByRole("tab", { name: "Verify GSTIN" }));
    const verifyGstin = screen.getAllByLabelText(/^GSTIN/).find((el) => !el.closest("[hidden]"))!;
    fireEvent.change(verifyGstin, { target: { value: "27AAPFU0939F1ZX" } });
    fireEvent.click(lastButtonNamed("Verify GSTIN"));
    const verifyForm = visiblePanel(container, '[aria-label="Verify GSTIN"]');
    expect(within(verifyForm as HTMLElement).getByText(/Enter a valid 15-character GSTIN/)).toBeInTheDocument();
  });

  // GAP-BILLING-GSTN-03: honest "not reconciled" note on the submit form.
  it("shows an honest note that totals are not checked against invoices (GSTN-03)", () => {
    render(<GstnConsole />);
    expect(within(submitPanel()).getByText(/not automatically checked against your billing/i)).toBeInTheDocument();
  });

  // GAP-BILLING-GSTN-05: honest "no filing history" note on the status form.
  it("shows an honest note that a full filing history is not available yet (GSTN-05)", () => {
    const { container } = render(<GstnConsole />);
    const statusForm = container.querySelector('[aria-label="Check GST return status"]') as HTMLElement;
    expect(within(statusForm).getByText(/full filing history for a GSTIN\/period is not/i)).toBeInTheDocument();
  });

  describe("keyboard tab navigation (roving tabindex)", () => {
    it("moves focus and activation across tabs with ArrowRight/ArrowLeft, wrapping at the ends", () => {
      render(<GstnConsole />);
      const submitTab = screen.getByRole("tab", { name: "Submit Return" });
      const statusTab = screen.getByRole("tab", { name: "Return Status" });
      const historyTab = screen.getByRole("tab", { name: "Filing History" });
      const verifyTab = screen.getByRole("tab", { name: "Verify GSTIN" });

      expect(submitTab).toHaveAttribute("aria-selected", "true");
      expect(submitTab).toHaveAttribute("tabindex", "0");
      expect(statusTab).toHaveAttribute("tabindex", "-1");
      expect(verifyTab).toHaveAttribute("tabindex", "-1");

      fireEvent.keyDown(submitTab, { key: "ArrowRight" });
      expect(statusTab).toHaveAttribute("aria-selected", "true");
      expect(statusTab).toHaveAttribute("tabindex", "0");
      expect(submitTab).toHaveAttribute("tabindex", "-1");

      fireEvent.keyDown(statusTab, { key: "ArrowRight" });
      expect(historyTab).toHaveAttribute("aria-selected", "true");

      fireEvent.keyDown(historyTab, { key: "ArrowRight" });
      expect(verifyTab).toHaveAttribute("aria-selected", "true");

      // Wraps from the last tab back to the first.
      fireEvent.keyDown(verifyTab, { key: "ArrowRight" });
      expect(submitTab).toHaveAttribute("aria-selected", "true");

      // Wraps from the first tab back to the last.
      fireEvent.keyDown(submitTab, { key: "ArrowLeft" });
      expect(verifyTab).toHaveAttribute("aria-selected", "true");
    });

    it("Home and End jump to the first and last tab", () => {
      render(<GstnConsole />);
      const submitTab = screen.getByRole("tab", { name: "Submit Return" });
      const verifyTab = screen.getByRole("tab", { name: "Verify GSTIN" });

      fireEvent.keyDown(submitTab, { key: "End" });
      expect(verifyTab).toHaveAttribute("aria-selected", "true");

      fireEvent.keyDown(verifyTab, { key: "Home" });
      expect(submitTab).toHaveAttribute("aria-selected", "true");
    });

    it("ArrowRight actually swaps the rendered panel end-to-end, not just the tab strip's own state", () => {
      const { container } = render(<GstnConsole />);
      const returnStatusForm = '[aria-label="Check GST return status"]';

      // Submit Return is active: its form is visible, Return Status is hidden (panels stay mounted).
      expect(visiblePanel(container, '[aria-label="Submit GST return"]')).not.toBeNull();
      expect(visiblePanel(container, returnStatusForm)).toBeNull();

      fireEvent.keyDown(screen.getByRole("tab", { name: "Submit Return" }), { key: "ArrowRight" });

      // Now on Return Status -- its own form is the visible one.
      expect(visiblePanel(container, returnStatusForm)).not.toBeNull();
      expect(visiblePanel(container, '[aria-label="Submit GST return"]')).toBeNull();
    });
  });

  // GAP-BILLING-GSTN-07: submit result renders "filed" as a green (good) pill, not warn.
  // Given: a successful GSTN submission returns status "filed"
  // When: the console renders the result
  // Then: the StatusPill for "filed" carries the class "pill good"
  it("renders a filed GSTN return with a green (good) pill, not warn (GSTN-07)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            referenceId: "ref-filed",
            status: "filed",
            gstin: VALID_GSTIN,
            returnPeriod: "04/2026",
            submittedAt: "2026-08-01T00:00:00Z",
          },
        }),
        { status: 201 },
      ),
    );
    render(<GstnConsole />);
    fillSubmitForm();
    fireEvent.click(screen.getByRole("button", { name: "Submit Return" }));
    await waitFor(() => expect(screen.getByText(/File GSTR1/)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "File return" }));
    await waitFor(() => expect(screen.getByText("ref-filed")).toBeInTheDocument());
    // The status label "Filed" must carry the green "good" pill class.
    const pill = screen.getByText("Filed");
    expect(pill.className).toContain("good");
    expect(pill.className).not.toContain("warn");
  });


  // GAP-BILLING-GSTN-05 (UAT B4): filing history tab + duplicate-period warning.
  describe("filing history (GAP-BILLING-GSTN-05)", () => {
    const filed = {
      id: "r1", gstin: VALID_GSTIN, returnPeriod: "04/2026", returnType: "GSTR1", referenceId: "REF-OLD-1", status: "filed",
      totalTaxableMinor: "1250000000", totalCgstMinor: "112500000", totalSgstMinor: "112500000", totalIgstMinor: "0", filedAt: "2026-05-10T04:30:00.000Z",
    };

    it("lists previously filed returns on the Filing History tab", async () => {
      vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify({ data: [filed] }), { status: 200 }));
      render(<GstnConsole />);
      fireEvent.click(screen.getByRole("tab", { name: "Filing History" }));
      await waitFor(() => expect(screen.getAllByText("04/2026").length).toBeGreaterThan(0));
      expect(screen.getAllByText("GSTR1").length).toBeGreaterThan(0);
    });

    it("shows an honest empty state when nothing has been filed", async () => {
      vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify({ data: [] }), { status: 200 }));
      render(<GstnConsole />);
      fireEvent.click(screen.getByRole("tab", { name: "Filing History" }));
      await waitFor(() => expect(screen.getAllByText("No returns filed yet").length).toBeGreaterThan(0));
    });

    it("a failed history read is an error with retry, not an empty list", async () => {
      vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify({ message: "boom" }), { status: 500 }));
      render(<GstnConsole />);
      fireEvent.click(screen.getByRole("tab", { name: "Filing History" }));
      await waitFor(() => expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument());
      expect(screen.queryByText("No returns filed yet")).not.toBeInTheDocument();
    });

    it("warns in the review dialog when the same GSTIN, period and type was already filed", async () => {
      vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify({ data: [filed] }), { status: 200 }));
      render(<GstnConsole />);
      fillSubmitForm();
      fireEvent.click(screen.getByRole("button", { name: "Submit Return" }));
      await waitFor(() => expect(screen.getByText(/File GSTR1 for 04\/2026\?/)).toBeInTheDocument());
      expect(screen.getByText(/was already filed for this GSTIN/)).toBeInTheDocument();
      expect(screen.getByText("REF-OLD-1")).toBeInTheDocument();
    });

    it("describes the earlier return's status in plain words, never the raw status value", async () => {
      vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify({ data: [{ ...filed, status: "processing" }] }), { status: 200 }));
      render(<GstnConsole />);
      fillSubmitForm();
      fireEvent.click(screen.getByRole("button", { name: "Submit Return" }));
      await waitFor(() => expect(screen.getByText(/was already filed for this GSTIN/)).toBeInTheDocument());
      expect(screen.getByText(/status being processed\)/)).toBeInTheDocument();
      expect(screen.queryByText(/status processing\)/)).not.toBeInTheDocument();
    });

    it("shows no duplicate warning when only a rejected return exists or history is empty", async () => {
      vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify({ data: [{ ...filed, status: "rejected" }] }), { status: 200 }));
      render(<GstnConsole />);
      fillSubmitForm();
      fireEvent.click(screen.getByRole("button", { name: "Submit Return" }));
      await waitFor(() => expect(screen.getByText(/File GSTR1 for 04\/2026\?/)).toBeInTheDocument());
      expect(screen.queryByText(/was already filed for this GSTIN/)).not.toBeInTheDocument();
    });
  });

  // GAP-BILLING-GSTN-03 (UAT B4): prefill from invoices + variance reconciliation.
  describe("prefill from invoices (GAP-BILLING-GSTN-03)", () => {
    const prep = {
      gstin: VALID_GSTIN, period: "04/2026", invoiceCount: 3,
      totalTaxableMinor: "1250000000", totalCgstMinor: "112500000", totalSgstMinor: "112500000", totalIgstMinor: "0",
      unsplitTaxMinor: "0", unsplitTaxInvoiceCount: 0,
    };
    function serve(data: unknown = prep) {
      return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
        const url = String(input);
        if (url.includes("returns/prepare")) return new Response(JSON.stringify({ data }), { status: 200 });
        if (url.includes("v1/billing/gstn/returns?")) return new Response(JSON.stringify({ data: [] }), { status: 200 });
        return new Response(JSON.stringify({ data: { referenceId: "ref-p", status: "submitted", gstin: VALID_GSTIN, returnPeriod: "04/2026", submittedAt: "x" } }), { status: 201 });
      });
    }
    function typeGstinAndPeriod() {
      const p = within(submitPanel());
      fireEvent.change(p.getByLabelText(/^GSTIN/), { target: { value: VALID_GSTIN } });
      fireEvent.change(p.getByLabelText(/^Return Period/), { target: { value: "04/2026" } });
    }

    it("fills the four totals from the invoice totals (paise -> rupees) and shows the invoice count", async () => {
      serve();
      render(<GstnConsole />);
      typeGstinAndPeriod();
      fireEvent.click(screen.getByRole("button", { name: "Prefill from invoices" }));
      await waitFor(() => expect((within(submitPanel()).getByLabelText(/^Total Taxable Value/) as HTMLInputElement).value).toBe("12500000.00"));
      expect((within(submitPanel()).getByLabelText(/^Total CGST/) as HTMLInputElement).value).toBe("1125000.00");
      expect((within(submitPanel()).getByLabelText(/^Total IGST/) as HTMLInputElement).value).toBe("0.00");
      expect(screen.getByText(/3 issued invoices/)).toBeInTheDocument();
      expect(screen.queryByText("Differs from invoices")).not.toBeInTheDocument();
    });

    it("needs a valid GSTIN and period first and calls nothing otherwise", () => {
      const spy = serve();
      render(<GstnConsole />);
      fireEvent.click(screen.getByRole("button", { name: "Prefill from invoices" }));
      expect(within(submitPanel()).getByText(/Enter a valid 15-character GSTIN/)).toBeInTheDocument();
      expect(spy).not.toHaveBeenCalled();
    });

    it("editing a prefilled total shows the variance and filing needs the acknowledgement", async () => {
      const spy = serve();
      render(<GstnConsole />);
      typeGstinAndPeriod();
      fireEvent.click(screen.getByRole("button", { name: "Prefill from invoices" }));
      await waitFor(() => expect((within(submitPanel()).getByLabelText(/^Total CGST/) as HTMLInputElement).value).toBe("1125000.00"));
      fireEvent.change(within(submitPanel()).getByLabelText(/^Total CGST/), { target: { value: "1000000" } });
      expect(screen.getByText("Differs from invoices")).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "Submit Return" }));
      await waitFor(() => expect(screen.getByText(/Tick the box to confirm the difference/)).toBeInTheDocument());
      expect(screen.queryByText(/File GSTR1 for 04\/2026\?/)).not.toBeInTheDocument();
      expect(filings(spy)).toHaveLength(0);

      fireEvent.click(screen.getByRole("checkbox", { name: /I have checked the difference/ }));
      fireEvent.click(screen.getByRole("button", { name: "Submit Return" }));
      await waitFor(() => expect(screen.getByText(/File GSTR1 for 04\/2026\?/)).toBeInTheDocument());
    });

    it("changing the totals again after acknowledging requires a fresh acknowledgement", async () => {
      serve();
      render(<GstnConsole />);
      typeGstinAndPeriod();
      fireEvent.click(screen.getByRole("button", { name: "Prefill from invoices" }));
      await waitFor(() => expect((within(submitPanel()).getByLabelText(/^Total CGST/) as HTMLInputElement).value).toBe("1125000.00"));
      fireEvent.change(within(submitPanel()).getByLabelText(/^Total CGST/), { target: { value: "1000000" } });
      fireEvent.click(screen.getByRole("checkbox", { name: /I have checked the difference/ }));
      expect(screen.getByRole("checkbox", { name: /I have checked the difference/ })).toBeChecked();
      fireEvent.change(within(submitPanel()).getByLabelText(/^Total CGST/), { target: { value: "999999" } });
      expect(screen.getByRole("checkbox", { name: /I have checked the difference/ })).not.toBeChecked();
    });

    it("reports invoices whose tax has no CGST/SGST/IGST split instead of hiding them", async () => {
      serve({ ...prep, unsplitTaxMinor: "18000", unsplitTaxInvoiceCount: 2 });
      render(<GstnConsole />);
      typeGstinAndPeriod();
      fireEvent.click(screen.getByRole("button", { name: "Prefill from invoices" }));
      await waitFor(() => expect(screen.getByText(/2 invoices have tax of/)).toBeInTheDocument());
    });

    it("a failed prefill is an error and leaves the typed totals alone", async () => {
      vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify({ message: "nope" }), { status: 500 }));
      render(<GstnConsole />);
      typeGstinAndPeriod();
      fireEvent.change(within(submitPanel()).getByLabelText(/^Total CGST/), { target: { value: "5" } });
      fireEvent.click(screen.getByRole("button", { name: "Prefill from invoices" }));
      await waitFor(() => expect(screen.getAllByRole("alert").length).toBeGreaterThan(0));
      expect((within(submitPanel()).getByLabelText(/^Total CGST/) as HTMLInputElement).value).toBe("5");
    });
  });
});
