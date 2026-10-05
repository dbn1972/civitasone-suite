import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within, waitFor } from "@testing-library/react";

import CitizenFeedbackPage from "./page";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

function withIntl(ui: React.ReactElement) {
  return (
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {ui}
    </NextIntlClientProvider>
  );
}
import * as feedback from "@/lib/crm/feedback";

// GAP-CRM-VOICE-OF-CUSTOMER-FEEDBACK-05: submission is now wired to crm-service.
vi.mock("@/lib/crm/feedback", async (orig) => {
  const actual = await orig<typeof import("@/lib/crm/feedback")>();
  return { ...actual, submitCitizenFeedback: vi.fn() };
});

describe("CitizenFeedbackPage (GAP-CRM-VOICE-OF-CUSTOMER-FEEDBACK-05 — wired)", () => {
  beforeEach(() => {
    vi.mocked(feedback.submitCitizenFeedback).mockReset();
    vi.mocked(feedback.submitCitizenFeedback).mockResolvedValue();
  });

  it("offers an enabled 'Submit feedback' control (submission is now live)", () => {
    render(withIntl(<CitizenFeedbackPage />));
    expect(screen.getByRole("button", { name: /submit feedback/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /submission unavailable/i })).not.toBeInTheDocument();
  });

  it("submits the rating + comment + optional 'Regarding' service request", async () => {
    render(withIntl(<CitizenFeedbackPage />));
    fireEvent.click(screen.getByRole("radio", { name: "4 stars" }));
    fireEvent.change(screen.getByPlaceholderText(/tell us about your experience/i), {
      target: { value: "Great service" },
    });
    fireEvent.change(screen.getByPlaceholderText(/service request id this feedback is about/i), {
      target: { value: "44444444-dddd-4000-8000-00000000f001" },
    });
    fireEvent.submit(document.querySelector("form") as HTMLFormElement);

    await waitFor(() => expect(feedback.submitCitizenFeedback).toHaveBeenCalledTimes(1));
    expect(feedback.submitCitizenFeedback).toHaveBeenCalledWith(
      expect.objectContaining({
        rating: 4,
        comment: "Great service",
        serviceRequestId: "44444444-dddd-4000-8000-00000000f001",
      }),
    );
    expect(await screen.findByText(/your feedback has been recorded/i)).toBeInTheDocument();
  });

  it("does not submit without a rating", () => {
    render(withIntl(<CitizenFeedbackPage />));
    fireEvent.submit(document.querySelector("form") as HTMLFormElement);
    expect(feedback.submitCitizenFeedback).not.toHaveBeenCalled();
    expect(screen.getByText(/choose a service rating/i)).toBeInTheDocument();
  });

  it("rejects a malformed service request reference client-side", () => {
    render(withIntl(<CitizenFeedbackPage />));
    fireEvent.click(screen.getByRole("radio", { name: "5 stars" }));
    fireEvent.change(screen.getByPlaceholderText(/service request id this feedback is about/i), {
      target: { value: "not-a-uuid" },
    });
    fireEvent.submit(document.querySelector("form") as HTMLFormElement);
    expect(feedback.submitCitizenFeedback).not.toHaveBeenCalled();
    expect(screen.getAllByText(/valid service request id/i).length).toBeGreaterThan(0);
  });

  it("surfaces a submission error without claiming success", async () => {
    vi.mocked(feedback.submitCitizenFeedback).mockRejectedValue(new Error("server down"));
    render(withIntl(<CitizenFeedbackPage />));
    fireEvent.click(screen.getByRole("radio", { name: "3 stars" }));
    fireEvent.submit(document.querySelector("form") as HTMLFormElement);
    expect(await screen.findByText(/server down/i)).toBeInTheDocument();
    expect(screen.queryByText(/your feedback has been recorded/i)).not.toBeInTheDocument();
  });

  it("shows a DPDP processing notice (submission is live)", () => {
    render(withIntl(<CitizenFeedbackPage />));
    const notices = screen.getAllByRole("note", { name: /data protection notice/i });
    expect(notices.length).toBeGreaterThan(0);
    expect(screen.getByText(/visible only to authorised administrators/i)).toBeInTheDocument();
  });

  // ── Preserved a11y behaviour (GAP-CRM-VOICE-OF-CUSTOMER-FEEDBACK-04) ──
  it("exposes the rating as a required radiogroup", () => {
    render(withIntl(<CitizenFeedbackPage />));
    const group = screen.getByRole("radiogroup", { name: /service rating/i });
    expect(group).toHaveAttribute("aria-required", "true");
    expect(group).toHaveAttribute("aria-describedby", "rating-required-hint");
  });

  it("is a single tab stop until a star is chosen (roving tabindex)", () => {
    render(withIntl(<CitizenFeedbackPage />));
    const group = screen.getByRole("radiogroup", { name: /service rating/i });
    const radios = within(group).getAllByRole("radio");
    expect(radios).toHaveLength(5);
    const tabbable = radios.filter((r) => r.getAttribute("tabindex") === "0");
    expect(tabbable).toHaveLength(1);
  });

  it("moves the selection with ArrowRight / ArrowLeft and marks it checked", () => {
    render(withIntl(<CitizenFeedbackPage />));
    const group = screen.getByRole("radiogroup", { name: /service rating/i });
    const firstStar = within(group).getByRole("radio", { name: "1 star" });
    fireEvent.keyDown(firstStar, { key: "ArrowRight" });
    expect(screen.getByRole("radio", { name: "2 stars" })).toHaveAttribute("aria-checked", "true");
    fireEvent.keyDown(screen.getByRole("radio", { name: "2 stars" }), { key: "ArrowLeft" });
    expect(screen.getByRole("radio", { name: "1 star" })).toHaveAttribute("aria-checked", "true");
  });

  it("uses distinct glyphs for selected (★) vs unselected (☆), not colour alone", () => {
    render(withIntl(<CitizenFeedbackPage />));
    fireEvent.click(screen.getByRole("radio", { name: "3 stars" }));
    expect(screen.getAllByText("★")).toHaveLength(3);
    expect(screen.getAllByText("☆")).toHaveLength(2);
  });

  it("has no required consent checkbox (notice, not a checkbox)", () => {
    render(withIntl(<CitizenFeedbackPage />));
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });
});
