import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: vi.fn() }),
}));

import { FollowUpModal } from "./FollowUpModal";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

function withIntl(ui: React.ReactElement) {
  return (
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {ui}
    </NextIntlClientProvider>
  );
}

const ACCOUNT_ID = "acct-0001";

describe("FollowUpModal", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    pushMock.mockReset();
  });

  // Regression test for the CRITICAL bug: the follow-up modal posted to
  // fetch("/api/v1/crm/service-requests") instead of the only working
  // client-mutation prefix "/api/proxy/v1/crm/service-requests" — creating a
  // follow-up from the Account Health screen 404'd every time.
  it("creates the follow-up service request against the correct proxied endpoint", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: { id: "sr-followup-1" } }), { status: 201 }),
    );

    render(withIntl(<FollowUpModal accountId={ACCOUNT_ID} />));
    fireEvent.click(screen.getByRole("button", { name: "Create Follow-up" }));

    fireEvent.change(screen.getByLabelText(/contact name/i), { target: { value: "Suresh Rao" } });
    fireEvent.change(screen.getByLabelText(/service type/i), { target: { value: "Renewal Support" } });
    fireEvent.click(screen.getByRole("button", { name: "Create Service Request" }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/crm/service-requests/sr-followup-1"));

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("/api/proxy/v1/crm/service-requests");
    expect((init as RequestInit).method).toBe("POST");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.citizenName).toBe("Suresh Rao");
    expect(body.relatedAccountId).toBe(ACCOUNT_ID);
  });

  // UX-016: this used to surface the backend's raw `message` field (or a
  // bare `HTTP ${status}` fallback) verbatim. It must now show only the
  // catalogued, clerk-safe copy — never the raw server text.
  it("shows a clerk-safe error inside the modal instead of the raw server text, and does not navigate away", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ message: "subject is required" }), { status: 422 }),
    );

    render(withIntl(<FollowUpModal accountId={ACCOUNT_ID} />));
    fireEvent.click(screen.getByRole("button", { name: "Create Follow-up" }));
    fireEvent.change(screen.getByLabelText(/contact name/i), { target: { value: "Suresh Rao" } });
    fireEvent.change(screen.getByLabelText(/service type/i), { target: { value: "Renewal Support" } });
    fireEvent.click(screen.getByRole("button", { name: "Create Service Request" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/Some details weren't accepted\. Check what you entered and try again\./);
    expect(screen.queryByText("subject is required")).not.toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });

  // GAP-CRM-HEALTH-ACCOUNTID-01 — the dialog used to label the account with its
  // raw UUID, so a clerk could not confirm which account they were acting on.
  // With a resolved name it must show the name, not the id.
  it("shows the resolved account name in the dialog header, not the raw id", () => {
    render(withIntl(<FollowUpModal accountId={ACCOUNT_ID} accountName="Bharat Steel Ltd" />));
    fireEvent.click(screen.getByRole("button", { name: "Create Follow-up" }));

    expect(screen.getByText("Bharat Steel Ltd")).toBeInTheDocument();
    expect(screen.queryByText(ACCOUNT_ID)).not.toBeInTheDocument();
    // The default subject also carries the name rather than the opaque id.
    const subject = screen.getByLabelText(/subject/i) as HTMLInputElement;
    expect(subject.value).toContain("Bharat Steel Ltd");
    expect(subject.value).not.toContain(ACCOUNT_ID);
  });

  // Fallback: with no name resolved the dialog still renders, showing the id so
  // the clerk at least has a reference.
  it("falls back to the account id when no name is available", () => {
    render(withIntl(<FollowUpModal accountId={ACCOUNT_ID} accountName={null} />));
    fireEvent.click(screen.getByRole("button", { name: "Create Follow-up" }));
    expect(screen.getByText(ACCOUNT_ID)).toBeInTheDocument();
  });
});
