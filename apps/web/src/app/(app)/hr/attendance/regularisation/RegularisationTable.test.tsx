import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import { RegularisationTable } from "./RegularisationTable";
import type { AttendanceRegularisation } from "@civitasone/types";

const REG: AttendanceRegularisation = {
  id: "r1",
  employeeId: "e1",
  employeeName: "Test Employee",
  date: "2026-09-01",
  reason: "Forgot to check in",
  requestedStatus: "present",
  requestedAt: "2026-09-02T00:00:00.000Z",
  status: "pending",
};

/**
 * UX-016: this used to show the raw backend response text (falling back to
 * `${decision} failed (${res.status})`) verbatim on both the not-ok response
 * branch and the catch branch (`err.message`) — the same class of leak
 * useFormError closes fleet-wide (UX-003).
 */
describe("RegularisationTable — UX-016 clerk-safe errors", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  function openApproveDialog() {
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <RegularisationTable regs={[REG]} source="api" />
      </NextIntlClientProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: /approve/i }));
  }

  it("shows a clerk-safe message, never the raw HTTP status, when the decision fails", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 500 }));
    openApproveDialog();

    const dialog = await screen.findByRole("alertdialog");
    fireEvent.change(within(dialog).getByLabelText(/approval remarks/i), { target: { value: "Looks fine" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /^approve$/i }));

    await waitFor(() => expect(dialog).toHaveTextContent(/couldn't save/i));
    expect(dialog.textContent).not.toMatch(/\b500\b/);
  });

  it("never surfaces raw server response text on a plain-text failure", async () => {
    fetchMock.mockResolvedValue(new Response("approve failed at hrms-service:214", { status: 502 }));
    openApproveDialog();

    const dialog = await screen.findByRole("alertdialog");
    fireEvent.change(within(dialog).getByLabelText(/approval remarks/i), { target: { value: "Looks fine" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /^approve$/i }));

    await waitFor(() => expect(dialog).toHaveTextContent(/couldn't save/i));
    expect(dialog.textContent).not.toMatch(/hrms-service/);
  });
});
