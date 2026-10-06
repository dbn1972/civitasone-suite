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
    expect(fetchSpy).not.toHaveBeenCalled();
    // GAP-BILLING-GSTN-02: taxable value entered as 12500000 rupees -> ₹ summary
    expect(screen.getAllByText("₹1,25,00,000.00").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "File return" }));
    await waitFor(() => expect(screen.getByText("ref-1")).toBeInTheDocument());
    expect(fetchSpy).toHaveBeenCalledTimes(1);
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
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.totalTaxableValue).toBe("1250000000");
    expect(body.totalCgst).toBe("112500000");
    expect(body.totalIgst).toBe("0");
    // GAP-BILLING-GSTN-01: an idempotency key is sent.
    const headers = (fetchSpy.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
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
});
