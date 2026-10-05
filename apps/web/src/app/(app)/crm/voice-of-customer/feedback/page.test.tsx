import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

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

describe("CitizenFeedbackPage (preview — submission not wired)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // GAP-CRM-VOICE-OF-CUSTOMER-FEEDBACK-01: the submit control must stay disabled
  // so nothing can appear to be accepted silently.
  it("keeps the submit control disabled", () => {
    render(withIntl(<CitizenFeedbackPage />));
    const submit = screen.getByRole("button", { name: /submission unavailable/i });
    expect(submit).toBeDisabled();
  });

  it("tells the respondent nothing entered is saved", () => {
    render(withIntl(<CitizenFeedbackPage />));
    expect(screen.getByText(/nothing entered below is saved/i)).toBeInTheDocument();
  });

  // GAP-CRM-VOICE-OF-CUSTOMER-FEEDBACK-01/-03: there must be NO required consent
  // checkbox — collecting (or appearing to collect) consent for discarded data
  // is itself a DPDP-notice risk. The DPDP terms are shown as a plain notice.
  it("has no DPDP consent checkbox, only a non-collecting DPDP notice", () => {
    render(withIntl(<CitizenFeedbackPage />));
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    const notices = screen.getAllByRole("note", { name: /data protection notice/i });
    expect(notices.length).toBeGreaterThan(0);
    expect(screen.getByText(/no consent is taken and nothing you type/i)).toBeInTheDocument();
  });

  // GAP-CRM-VOICE-OF-CUSTOMER-FEEDBACK-03: the subtitle used to promise
  // "confidential" while the (now removed) consent text spoke of processing;
  // the heading copy must not over-promise about data that is not collected.
  it("does not promise confidentiality for data it does not collect", () => {
    render(withIntl(<CitizenFeedbackPage />));
    expect(screen.queryByText(/your response is confidential/i)).not.toBeInTheDocument();
    expect(screen.getByText(/nothing entered here is collected or stored/i)).toBeInTheDocument();
  });

  // GAP-CRM-VOICE-OF-CUSTOMER-FEEDBACK-01: an Enter keypress must not hit the
  // dead endpoint — handleSubmit only preventDefault, there is no fetch.
  it("never calls fetch on an (accidental) form submit", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}"));
    render(withIntl(<CitizenFeedbackPage />));
    const form = document.querySelector("form");
    expect(form).not.toBeNull();
    fireEvent.submit(form as HTMLFormElement);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
