import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const pushMock = vi.fn();
const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}));

import { NewTrainingForm } from "./NewTrainingForm";

function renderForm() {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <NewTrainingForm />
    </NextIntlClientProvider>,
  );
}

describe("NewTrainingForm", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    pushMock.mockReset();
    refreshMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    // The fixtures use hard-coded 2026-10-0x dates; the form warns about a
    // From Date in the past relative to "today", so pin only Date (timers stay
    // real so waitFor/findBy keep polling) to keep them in the future forever.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-15T05:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function fillRequiredFields() {
    renderForm();
    fireEvent.change(screen.getByLabelText(/^title/i), { target: { value: "Advanced Excel Training" } });
    fireEvent.change(screen.getByLabelText(/from date/i), { target: { value: "2026-10-01" } });
    fireEvent.change(screen.getByLabelText(/to date/i), { target: { value: "2026-10-02" } });
    fireEvent.change(screen.getByLabelText(/max participants/i), { target: { value: "30" } });
  }

  function fillAndSubmit() {
    fillRequiredFields();
    fireEvent.click(screen.getByRole("button", { name: /create training program/i }));
  }

  describe("UX-016 clerk-safe errors", () => {
    it("shows a clerk-safe message, never the raw server text, when creation fails", async () => {
      fetchMock.mockResolvedValue(new Response("hrms-service training-create trace at line 40", { status: 500 }));
      fillAndSubmit();

      const alert = await screen.findByRole("alert");
      await waitFor(() => expect(alert).toHaveTextContent(/couldn't save/i));
      expect(alert.textContent).not.toMatch(/hrms-service/);
      expect(alert.textContent).not.toMatch(/\b500\b/);
    });
  });

  describe("GAP-HR-TRAINING-NEW-01 — honest async-create messaging", () => {
    it("never claims the program was 'created successfully' for a 202-accepted response, and disables the button after success", async () => {
      fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: "t-1", status: "accepted" }), { status: 202 }));
      fillAndSubmit();

      const status = await screen.findByRole("status");
      expect(status.textContent).toMatch(/submitted/i);
      expect(status.textContent).not.toMatch(/created successfully/i);

      await waitFor(() =>
        expect(screen.getByRole("button", { name: /create training program/i })).toBeDisabled(),
      );
      expect(refreshMock).toHaveBeenCalled();
    });
  });

  describe("GAP-HR-TRAINING-NEW-03 — validation", () => {
    it("rejects a non-integer Max Participants without making a network call", async () => {
      fillRequiredFields();
      fireEvent.change(screen.getByLabelText(/max participants/i), { target: { value: "2.5" } });
      fireEvent.click(screen.getByRole("button", { name: /create training program/i }));

      await waitFor(() => expect(screen.getByText(/please fix the highlighted fields/i)).toBeInTheDocument());
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("rejects a To Date before the From Date without making a network call", async () => {
      fillRequiredFields();
      fireEvent.change(screen.getByLabelText(/to date/i), { target: { value: "2026-09-01" } });
      fireEvent.click(screen.getByRole("button", { name: /create training program/i }));

      await waitFor(() => expect(screen.getByText(/to date must be on or after from date/i)).toBeInTheDocument());
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("warns (but does not block) a From Date in the past", () => {
      renderForm();
      fireEvent.change(screen.getByLabelText(/from date/i), { target: { value: "2020-01-01" } });
      expect(screen.getByText(/this start date is in the past/i)).toBeInTheDocument();
    });
  });

  describe("SF-19 discard ConfirmDialog (replaces native confirm)", () => {
    function cancelLink() {
      return screen.getByRole("link", { name: /^cancel$/i });
    }

    it("opens the dialog without navigating when a dirty form is cancelled, and never calls window.confirm", () => {
      const confirmSpy = vi.spyOn(window, "confirm");
      renderForm();
      fireEvent.change(screen.getByLabelText(/^title/i), { target: { value: "typed something" } });
      const notPrevented = fireEvent.click(cancelLink());
      expect(notPrevented).toBe(false);
      expect(screen.getByRole("alertdialog")).toBeInTheDocument();
      expect(pushMock).not.toHaveBeenCalled();
      expect(confirmSpy).not.toHaveBeenCalled();
    });

    it("Escape closes the dialog and keeps the form without navigating", () => {
      renderForm();
      fireEvent.change(screen.getByLabelText(/^title/i), { target: { value: "typed something" } });
      fireEvent.click(cancelLink());
      expect(screen.getByRole("alertdialog")).toBeInTheDocument();
      fireEvent.keyDown(document, { key: "Escape" });
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
      expect(pushMock).not.toHaveBeenCalled();
      expect(screen.getByLabelText(/^title/i)).toHaveValue("typed something");
    });

    it("Keep editing closes the dialog and keeps the form without navigating", () => {
      renderForm();
      fireEvent.change(screen.getByLabelText(/^title/i), { target: { value: "typed something" } });
      fireEvent.click(cancelLink());
      fireEvent.click(screen.getByRole("button", { name: /^keep editing$/i }));
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
      expect(pushMock).not.toHaveBeenCalled();
      expect(screen.getByLabelText(/^title/i)).toHaveValue("typed something");
    });

    it("Discard navigates to the list", () => {
      renderForm();
      fireEvent.change(screen.getByLabelText(/^title/i), { target: { value: "typed something" } });
      fireEvent.click(cancelLink());
      fireEvent.click(screen.getByRole("button", { name: /^discard$/i }));
      expect(pushMock).toHaveBeenCalledWith("/hr/training");
    });

    it("a clean form does not open the dialog on Cancel", () => {
      const confirmSpy = vi.spyOn(window, "confirm");
      renderForm();
      const notPrevented = fireEvent.click(cancelLink());
      expect(notPrevented).toBe(true);
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
      expect(confirmSpy).not.toHaveBeenCalled();
      expect(pushMock).not.toHaveBeenCalled();
    });
  });
});
