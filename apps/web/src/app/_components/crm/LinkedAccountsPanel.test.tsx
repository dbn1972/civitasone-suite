import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as rtlRender, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { LinkedAccountsPanel } from "./LinkedAccountsPanel";
import * as aa from "@/lib/crm/activityAccount";

import type { ReactElement } from "react";

function render(ui: ReactElement) {
  return rtlRender(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {ui}
    </NextIntlClientProvider>,
  );
}


vi.mock("@/lib/crm/activityAccount", async (orig) => {
  const actual = await orig<typeof import("@/lib/crm/activityAccount")>();
  return { ...actual, getLinkedAccounts: vi.fn(), connectLinkedAccount: vi.fn(), deleteLinkedAccount: vi.fn() };
});

const acct: aa.LinkedAccount = { id: "l1", provider: "google", externalEmail: "a@b.com", status: "pending" };

beforeEach(() => {
  vi.mocked(aa.getLinkedAccounts).mockReset();
  vi.mocked(aa.connectLinkedAccount).mockReset();
  vi.mocked(aa.deleteLinkedAccount).mockReset();
});

describe("LinkedAccountsPanel (AC-004)", () => {
  it("is explicit that live sync is not switched on", async () => {
    vi.mocked(aa.getLinkedAccounts).mockResolvedValue({ data: [], source: "api" });
    render(<NextIntlClientProvider locale="en" messages={enMessages}><LinkedAccountsPanel /></NextIntlClientProvider>);
    await waitFor(() => expect(screen.getByText(/no connected accounts/i)).toBeInTheDocument());
    expect(screen.getByText(/live two-way sync is not/i)).toBeInTheDocument();
  });

  // GAP-CRM-LINKED-ACCOUNTS-01: typing an email alone is not proof of ownership;
  // the copy must say nothing syncs until the provider verifies ownership via its
  // own consent (OAuth) step, matching the server's fail-closed enforcement.
  it("states that nothing syncs until the provider verifies mailbox ownership (consent/OAuth)", async () => {
    vi.mocked(aa.getLinkedAccounts).mockResolvedValue({ data: [], source: "api" });
    render(<NextIntlClientProvider locale="en" messages={enMessages}><LinkedAccountsPanel /></NextIntlClientProvider>);
    await waitFor(() => expect(screen.getByText(/no connected accounts/i)).toBeInTheDocument());
    expect(screen.getByText(/prove you own\s+that mailbox or calendar/i)).toBeInTheDocument();
    expect(screen.getByText(/verifies ownership through its\s+own consent \(sign-in \/ OAuth\) step/i)).toBeInTheDocument();
    expect(screen.getByText(/Digital Personal Data Protection Act, 2023/i)).toBeInTheDocument();
  });

  it("shows the saved-info badge on a failed load", async () => {
    vi.mocked(aa.getLinkedAccounts).mockResolvedValue({ data: [], source: "error" });
    render(<NextIntlClientProvider locale="en" messages={enMessages}><LinkedAccountsPanel /></NextIntlClientProvider>);
    await waitFor(() => expect(screen.getAllByText(/couldn.t load/i)[0]).toBeInTheDocument());
  });

  it("blocks connect for an invalid email", async () => {
    vi.mocked(aa.getLinkedAccounts).mockResolvedValue({ data: [], source: "api" });
    render(<NextIntlClientProvider locale="en" messages={enMessages}><LinkedAccountsPanel /></NextIntlClientProvider>);
    await waitFor(() => expect(screen.getByText(/no connected accounts/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /request connection/i }));
    expect(await screen.findByText(/enter the mailbox or calendar email/i)).toBeInTheDocument();
    expect(aa.connectLinkedAccount).not.toHaveBeenCalled();
  });

  it("connects a provider as pending then reloads", async () => {
    vi.mocked(aa.getLinkedAccounts).mockResolvedValue({ data: [], source: "api" });
    vi.mocked(aa.connectLinkedAccount).mockResolvedValue(undefined);
    render(<NextIntlClientProvider locale="en" messages={enMessages}><LinkedAccountsPanel /></NextIntlClientProvider>);
    await waitFor(() => expect(screen.getByText(/no connected accounts/i)).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/provider/i), { target: { value: "o365" } });
    fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: "me@dept.gov.in" } });
    fireEvent.click(screen.getByRole("button", { name: /request connection/i }));
    await waitFor(() => expect(aa.connectLinkedAccount).toHaveBeenCalledWith("o365", "me@dept.gov.in"));
    expect(await screen.findByText(/connection requested/i)).toBeInTheDocument();
  });

  it("disconnects an account via ConfirmDialog", async () => {
    vi.mocked(aa.getLinkedAccounts).mockResolvedValue({ data: [acct], source: "api" });
    vi.mocked(aa.deleteLinkedAccount).mockResolvedValue(undefined);
    render(<NextIntlClientProvider locale="en" messages={enMessages}><LinkedAccountsPanel /></NextIntlClientProvider>);
    await waitFor(() => expect(screen.getByText("a@b.com")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /disconnect a@b.com/i }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /^disconnect$/i }));
    await waitFor(() => expect(aa.deleteLinkedAccount).toHaveBeenCalledWith("l1"));
  });

  // GAP-CRM-LINKED-ACCOUNTS-02: each status renders a distinct pill tone, not all "info".
  it("renders a distinct pill tone per status (not colour-only)", async () => {
    const rows: aa.LinkedAccount[] = [
      { id: "a1", provider: "google", externalEmail: "p@x.in", status: "pending" },
      { id: "a2", provider: "google", externalEmail: "c@x.in", status: "connected" },
      { id: "a3", provider: "google", externalEmail: "e@x.in", status: "error" },
      { id: "a4", provider: "google", externalEmail: "r@x.in", status: "revoked" },
    ];
    vi.mocked(aa.getLinkedAccounts).mockResolvedValue({ data: rows, source: "api" });
    const { container } = render(<LinkedAccountsPanel />);
    await waitFor(() => expect(screen.getByText("p@x.in")).toBeInTheDocument());
    const classes = Array.from(container.querySelectorAll("td .pill")).map((el) => el.className);
    expect(classes).toContain("pill warn"); // pending
    expect(classes).toContain("pill good"); // connected
    expect(classes).toContain("pill bad");  // error
    expect(classes).toContain("pill mut");  // revoked
    // and a non-colour cue ("Needs attention") is still present for error
    expect(screen.getByText(/needs attention/i)).toBeInTheDocument();
  });

  // GAP-CRM-LINKED-ACCOUNTS-03: the action's accessible name is honest ("Request connection").
  it("labels the submit as 'Request connection', not 'Connect provider'", async () => {
    vi.mocked(aa.getLinkedAccounts).mockResolvedValue({ data: [], source: "api" });
    render(<LinkedAccountsPanel />);
    await waitFor(() => expect(screen.getByText(/no connected accounts/i)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /request connection/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /connect provider/i })).not.toBeInTheDocument();
  });

  // GAP-CRM-LINKED-ACCOUNTS-04: on a failed load the form is disabled and a Retry is shown.
  it("disables the connect form and shows Retry when the list fails to load", async () => {
    vi.mocked(aa.getLinkedAccounts).mockResolvedValue({ data: [], source: "error" });
    render(<LinkedAccountsPanel />);
    await waitFor(() => expect(screen.getByText(/connections unavailable/i)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /request connection/i })).toBeDisabled();
    expect(screen.getByLabelText(/email address/i)).toBeDisabled();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  // GAP-CRM-LINKED-ACCOUNTS-04: a duplicate provider+email is blocked client-side (no POST).
  it("blocks a duplicate provider+email without POSTing", async () => {
    vi.mocked(aa.getLinkedAccounts).mockResolvedValue({
      data: [{ id: "a1", provider: "google", externalEmail: "a@x.in", status: "pending" }],
      source: "api",
    });
    render(<LinkedAccountsPanel />);
    await waitFor(() => expect(screen.getByText("a@x.in")).toBeInTheDocument());
    // provider defaults to google; enter the same (differently-cased) email.
    fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: "A@X.IN" } });
    fireEvent.click(screen.getByRole("button", { name: /request connection/i }));
    expect(await screen.findByText(/already connected/i)).toBeInTheDocument();
    expect(aa.connectLinkedAccount).not.toHaveBeenCalled();
  });
});
