import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { GstnConsole } from "./GstnConsole";

/**
 * The Tabs strip and the active panel's submit button can share an accessible
 * name (e.g. both "Submit Return"). The panel always renders after the tab
 * strip in the DOM, so the last match is the panel's action button.
 */
function lastButtonNamed(name: string): HTMLElement {
  const matches = screen.getAllByRole("button", { name });
  return matches[matches.length - 1];
}

describe("GstnConsole", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("validates required fields before submitting a GST return", () => {
    render(<GstnConsole />);
    fireEvent.click(lastButtonNamed("Submit Return"));
    expect(screen.getByText("Enter a valid 15-character GSTIN (e.g. 22AAAAA0000A1Z5).")).toBeInTheDocument();
  });

  it("rejects a malformed 15-character GSTIN on the Submit Return tab", () => {
    render(<GstnConsole />);
    // Right length, wrong structure (all digits instead of state+PAN+entity+Z+checksum).
    fireEvent.change(screen.getByLabelText(/^GSTIN/), { target: { value: "123456789012345" } });
    fireEvent.click(lastButtonNamed("Submit Return"));
    expect(screen.getByText("Enter a valid 15-character GSTIN (e.g. 22AAAAA0000A1Z5).")).toBeInTheDocument();
  });

  it("submits a GST return on valid input (happy path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            referenceId: "ref-1",
            status: "submitted",
            gstin: "07AAAAA0000A1Z5",
            returnPeriod: "04/2026",
            submittedAt: "2026-08-01T00:00:00Z",
          },
        }),
        { status: 201 },
      ),
    );

    render(<GstnConsole />);
    fireEvent.change(screen.getByLabelText(/^GSTIN/), { target: { value: "07AAAAA0000A1Z5" } });
    fireEvent.change(screen.getByLabelText(/^Return Period/), { target: { value: "04/2026" } });
    fireEvent.change(screen.getByLabelText(/^Total Taxable Value/), { target: { value: "1000000" } });
    fireEvent.change(screen.getByLabelText(/^Total CGST/), { target: { value: "90000" } });
    fireEvent.change(screen.getByLabelText(/^Total SGST/), { target: { value: "90000" } });
    fireEvent.change(screen.getByLabelText(/^Total IGST/), { target: { value: "0" } });
    fireEvent.click(lastButtonNamed("Submit Return"));

    await waitFor(() => {
      expect(screen.getByText("ref-1")).toBeInTheDocument();
    });
  });

  it("surfaces a clerk-safe message on failure, never the server's raw INTEGRATION_DISABLED code (UX-020)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ error: { code: "INTEGRATION_DISABLED", message: "GSTN integration is not available" } }),
        { status: 503 },
      ),
    );

    render(<GstnConsole />);
    fireEvent.change(screen.getByLabelText(/^GSTIN/), { target: { value: "07AAAAA0000A1Z5" } });
    fireEvent.change(screen.getByLabelText(/^Return Period/), { target: { value: "04/2026" } });
    fireEvent.change(screen.getByLabelText(/^Total Taxable Value/), { target: { value: "1000000" } });
    fireEvent.change(screen.getByLabelText(/^Total CGST/), { target: { value: "90000" } });
    fireEvent.change(screen.getByLabelText(/^Total SGST/), { target: { value: "90000" } });
    fireEvent.change(screen.getByLabelText(/^Total IGST/), { target: { value: "0" } });
    fireEvent.click(lastButtonNamed("Submit Return"));

    await waitFor(() => {
      expect(screen.getByText(/couldn't save/i)).toBeInTheDocument();
    });
    expect(screen.queryByText(/INTEGRATION_DISABLED: GSTN integration is not available/)).not.toBeInTheDocument();
  });

  it("switches to the Verify GSTIN tab and verifies a GSTIN", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            gstin: "07AAAAA0000A1Z5",
            legalName: "Example Pvt Ltd",
            tradeName: "Example",
            status: "active",
            registrationDate: "2020-01-01",
            lastUpdated: "2026-08-01",
          },
        }),
        { status: 200 },
      ),
    );

    render(<GstnConsole />);
    // Only the tab strip has this name before the panel switches — unambiguous here.
    fireEvent.click(screen.getByRole("tab", { name: "Verify GSTIN" }));
    fireEvent.change(screen.getByLabelText(/^GSTIN/), { target: { value: "07AAAAA0000A1Z5" } });
    fireEvent.click(lastButtonNamed("Verify GSTIN"));

    await waitFor(() => {
      expect(screen.getByText("Example Pvt Ltd")).toBeInTheDocument();
    });
  });

  it("rejects a malformed 15-character GSTIN on the Verify GSTIN tab", () => {
    render(<GstnConsole />);
    fireEvent.click(screen.getByRole("tab", { name: "Verify GSTIN" }));
    // Right length, wrong structure — must not reach the external GSTN API.
    fireEvent.change(screen.getByLabelText(/^GSTIN/), { target: { value: "123456789012345" } });
    fireEvent.click(lastButtonNamed("Verify GSTIN"));
    expect(screen.getByText("Enter a valid 15-character GSTIN (e.g. 22AAAAA0000A1Z5).")).toBeInTheDocument();
  });

  // GstnConsole is a real consumer of the shared ds/Tabs component's
  // roving-tabindex arrow-key model. Every other test in this file only
  // fires click events on the tab strip, so none of them exercise the
  // keyboard path at all -- these do, against the actual rendered console
  // (not just Tabs.tsx in isolation).
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

      // Submit Return's panel is showing.
      expect(screen.getByLabelText(/^GSTIN/)).toBeInTheDocument();
      expect(container.querySelector(returnStatusForm)).not.toBeInTheDocument();

      fireEvent.keyDown(screen.getByRole("tab", { name: "Submit Return" }), { key: "ArrowRight" });

      // Now on Return Status -- its own form replaces Submit Return's.
      expect(container.querySelector(returnStatusForm)).toBeInTheDocument();
    });
  });
});
