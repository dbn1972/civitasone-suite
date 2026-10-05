import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { LinkedAccountsPanel } from "./LinkedAccountsPanel";
import * as aa from "@/lib/crm/activityAccount";

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
    fireEvent.click(screen.getByRole("button", { name: /connect provider/i }));
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
    fireEvent.click(screen.getByRole("button", { name: /connect provider/i }));
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
});
