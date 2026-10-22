import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderWithIntl } from "@/lib/testUtils/intl";
import { render, screen, fireEvent, within, waitFor } from "@testing-library/react";

import CitizenFeedbackPage from "./page";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import hiMessages from "@/messages/hi.json";

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

  // ── GAP-CRM-VOICE-OF-CUSTOMER-FEEDBACK-03 (interim: no identifier is collected yet) ──
  it("says plainly that a Registered Citizen response is recorded without name, phone or ID", () => {
    render(withIntl(<CitizenFeedbackPage />));
    // Anonymous is the default: nothing to explain.
    expect(screen.queryByText(/does not collect the citizen.s name, phone number or ID/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "Registered Citizen" }));
    const note = screen.getByText(/does not collect the citizen.s name, phone number or ID/i);
    expect(note).toBeInTheDocument();
    expect(note).toHaveAttribute("role", "note");
    // ...and it points at the one real link to a record: the "Regarding" service request.
    expect(note).toHaveTextContent(/Regarding/);
    // No identifier input appears - none is accepted, so none is faked.
    expect(screen.queryByLabelText(/citizen id|mobile|phone/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "Anonymous" }));
    expect(screen.queryByText(/does not collect the citizen.s name, phone number or ID/i)).not.toBeInTheDocument();
  });

  it("submits a Registered Citizen response as such, with no invented identifier", async () => {
    render(withIntl(<CitizenFeedbackPage />));
    fireEvent.click(screen.getByRole("radio", { name: "4 stars" }));
    fireEvent.click(screen.getByRole("radio", { name: "Registered Citizen" }));
    fireEvent.submit(document.querySelector("form") as HTMLFormElement);
    await waitFor(() => expect(feedback.submitCitizenFeedback).toHaveBeenCalledTimes(1));
    const sent = vi.mocked(feedback.submitCitizenFeedback).mock.calls[0]![0] as unknown as Record<string, unknown>;
    expect(sent.submissionType).toBe("registered");
    expect(Object.keys(sent).sort()).toEqual(["comment", "rating", "submissionType"]);
  });

  // The DPDP notice and the labels render in the reader's language, not just English.
  it("renders the notice, labels and actions in Hindi when the locale is hi", () => {
    render(
      <NextIntlClientProvider locale="hi" messages={hiMessages}>
        <CitizenFeedbackPage />
      </NextIntlClientProvider>,
    );
    const notice = screen.getByRole("note", { name: hiMessages.crmCitizenFeedback.noticeAria });
    expect(notice).toHaveTextContent("डिजिटल व्यक्तिगत डेटा संरक्षण अधिनियम, 2023");
    expect(screen.getByRole("heading", { name: "नागरिक प्रतिक्रिया" })).toBeInTheDocument();
    expect(screen.getByText("टिप्पणियाँ / सुझाव")).toBeInTheDocument();
    expect(screen.getByText("प्रस्तुति का प्रकार")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "गुमनाम" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "पंजीकृत नागरिक" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: hiMessages.crmCitizenFeedback.submitFeedback })).toBeInTheDocument();
    expect(screen.getByPlaceholderText("इस सेवा के साथ अपने अनुभव के बारे में बताएँ...")).toBeInTheDocument();
    // Nothing the reader has to read is left in English.
    expect(screen.queryByText("Comments / Suggestions")).not.toBeInTheDocument();
    expect(screen.queryByText("Submission Type")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "पंजीकृत नागरिक" }));
    expect(screen.getByText(/यह प्रपत्र नागरिक का नाम, फ़ोन नंबर या आईडी एकत्र नहीं करता/)).toBeInTheDocument();
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

  // GAP-CRM-VOICE-OF-CUSTOMER-FEEDBACK-06 (COPY): the module name is "Voice of
  // Citizen" everywhere. The feedback form links back to it with that label and
  // never uses the old "Voice Of Customer" wording.
  it("links back to 'Voice of Citizen' and never says 'Voice Of Customer'", () => {
    renderWithIntl(<CitizenFeedbackPage />);
    expect(screen.getByRole("link", { name: /voice of citizen/i })).toBeInTheDocument();
    expect(screen.queryByText(/voice of customer/i)).not.toBeInTheDocument();
  });
});
