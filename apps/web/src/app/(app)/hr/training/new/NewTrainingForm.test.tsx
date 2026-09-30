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
  });
  afterEach(() => vi.unstubAllGlobals());

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
});
