import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as rtlRender, screen, fireEvent, waitFor, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

function render(ui: ReactElement) {
  return rtlRender(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

import { OnboardingDetail } from "./OnboardingDetail";
import * as onb from "@/lib/crm/onboarding";

vi.mock("@/lib/crm/onboarding", async (orig) => {
  const actual = await orig<typeof import("@/lib/crm/onboarding")>();
  return {
    ...actual,
    getOnboardingCase: vi.fn(),
    getOnboardingLookups: vi.fn(),
    advanceStage: vi.fn(),
    recordKyc: vi.fn(),
  };
});

function caseAt(stage: onb.OnboardingStage, kycStatus: onb.KycStatus): onb.OnboardingCase {
  return {
    id: "c1",
    dealId: "d1",
    accountId: "a1",
    stage,
    kycStatus,
    kycReference: null,
    kycVerifiedAt: null,
    completedAt: null,
    cancellationReason: null,
    createdAt: "2026-08-01T00:00:00Z",
    updatedAt: "2026-08-02T00:00:00Z",
    version: 2,
    accountName: null,
    dealName: null,
  };
}

beforeEach(() => {
  vi.mocked(onb.getOnboardingCase).mockReset();
  vi.mocked(onb.getOnboardingLookups).mockReset();
  vi.mocked(onb.getOnboardingLookups).mockResolvedValue({ dealNames: {}, accountNames: {} });
  vi.mocked(onb.advanceStage).mockReset();
  vi.mocked(onb.recordKyc).mockReset();
});

describe("OnboardingDetail (P1-9)", () => {
  it("offers ONLY the state-machine's allowed next stages for the current stage", async () => {
    vi.mocked(onb.getOnboardingCase).mockResolvedValue({ data: caseAt("verification", "submitted"), source: "api" });
    render(<OnboardingDetail id="c1" />);
    const select = await screen.findByLabelText(/move to/i);
    // verification → provisioning | cancelled ONLY
    expect(within(select).getByRole("option", { name: /Provisioning/ })).toBeInTheDocument();
    expect(within(select).getByRole("option", { name: /Cancelled/ })).toBeInTheDocument();
    expect(within(select).queryByRole("option", { name: /^Completed$/ })).not.toBeInTheDocument();
    expect(within(select).queryByRole("option", { name: /Documents submitted/ })).not.toBeInTheDocument();
  });

  it("KYC-gates completion: the Completed option is disabled until KYC is verified", async () => {
    vi.mocked(onb.getOnboardingCase).mockResolvedValue({ data: caseAt("provisioning", "submitted"), source: "api" });
    render(<OnboardingDetail id="c1" />);
    const select = await screen.findByLabelText(/move to/i);
    const completed = within(select).getByRole("option", { name: /Completed.*needs verified KYC/i }) as HTMLOptionElement;
    expect(completed.disabled).toBe(true);
    expect(onb.advanceStage).not.toHaveBeenCalled();
  });

  it("confirms before an advance, then reloads after the mutation", async () => {
    vi.mocked(onb.getOnboardingCase)
      .mockResolvedValueOnce({ data: caseAt("initiated", "pending"), source: "api" })
      .mockResolvedValue({ data: caseAt("documents_submitted", "pending"), source: "api" });
    vi.mocked(onb.advanceStage).mockResolvedValue({ accepted: false });
    render(<OnboardingDetail id="c1" />);

    fireEvent.change(await screen.findByLabelText(/move to/i), { target: { value: "documents_submitted" } });
    fireEvent.click(screen.getByRole("button", { name: /apply stage change/i }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /confirm change/i }));

    await waitFor(() =>
      expect(onb.advanceStage).toHaveBeenCalledWith("c1", { toStage: "documents_submitted", version: 2 }),
    );
    // reload = a second load call
    await waitFor(() => expect(onb.getOnboardingCase).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(/Case moved to "Documents submitted"/i)).toBeInTheDocument();
  });

  it("shows a clerk-safe message on a 422 KYC-gate rejection (never silent, never the raw backend code/text — UX-020)", async () => {
    // provisioning + verified so the Completed option is enabled and selectable,
    // but the BE still rejects (proves the UI trusts the BE, not just its mirror).
    // UX-020: advanceStage (apps/web/src/lib/crm/onboarding.ts) now rejects
    // with the clerk-safe catalogued message errorMessageFromResponse builds,
    // not the backend's raw "KYC_NOT_VERIFIED: ..." text — see
    // onboarding.test.ts for that mapping. This test only needs to prove
    // OnboardingDetail still shows *some* message (never silent) and never
    // the pre-UX-020 raw code, whatever the exact rejection text.
    vi.mocked(onb.getOnboardingCase).mockResolvedValue({ data: caseAt("provisioning", "verified"), source: "api" });
    vi.mocked(onb.advanceStage).mockRejectedValue(
      new Error("We couldn't save your information. Nothing was changed. Please try again in a moment."),
    );
    render(<OnboardingDetail id="c1" />);
    fireEvent.change(await screen.findByLabelText(/move to/i), { target: { value: "completed" } });
    fireEvent.click(screen.getByRole("button", { name: /apply stage change/i }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /confirm change/i }));
    expect((await screen.findAllByText(/couldn't save/i)).length).toBeGreaterThan(0);
    expect(screen.queryByText(/KYC_NOT_VERIFIED/)).not.toBeInTheDocument();
  });

  it("cancelling requires a reason in the dialog before it will submit", async () => {
    vi.mocked(onb.getOnboardingCase).mockResolvedValue({ data: caseAt("initiated", "pending"), source: "api" });
    vi.mocked(onb.advanceStage).mockResolvedValue({ accepted: false });
    render(<OnboardingDetail id="c1" />);
    fireEvent.change(await screen.findByLabelText(/move to/i), { target: { value: "cancelled" } });
    fireEvent.click(screen.getByRole("button", { name: /apply stage change/i }));
    const dialog = await screen.findByRole("alertdialog");
    // confirm is disabled while the required reason is empty
    const confirm = within(dialog).getByRole("button", { name: /cancel onboarding/i });
    expect(confirm).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText(/cancellation reason/i), {
      target: { value: "customer no longer wishes to proceed" },
    });
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(onb.advanceStage).toHaveBeenCalledWith("c1", {
        toStage: "cancelled",
        reason: "customer no longer wishes to proceed",
        version: 2,
      }),
    );
  });

  it("records a KYC outcome and reloads", async () => {
    vi.mocked(onb.getOnboardingCase)
      .mockResolvedValueOnce({ data: caseAt("verification", "submitted"), source: "api" })
      .mockResolvedValue({ data: caseAt("verification", "verified"), source: "api" });
    vi.mocked(onb.recordKyc).mockResolvedValue({ accepted: false });
    render(<OnboardingDetail id="c1" canApproveKyc />);
    fireEvent.change(await screen.findByLabelText(/new kyc outcome/i), { target: { value: "verified" } });
    // GAP-CRM-ONBOARDING-DETAIL-02: a verified outcome now requires a reference.
    fireEvent.change(screen.getByLabelText(/kyc reference/i), { target: { value: "KYC-123" } });
    fireEvent.click(screen.getByRole("button", { name: /record kyc outcome/i }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /record outcome/i }));
    await waitFor(() =>
      expect(onb.recordKyc).toHaveBeenCalledWith("c1", { status: "verified", reference: "KYC-123", version: 2 }),
    );
    await waitFor(() => expect(onb.getOnboardingCase).toHaveBeenCalledTimes(2));
  });

  it("shows the saved-info badge when the case fails to load", async () => {
    vi.mocked(onb.getOnboardingCase).mockResolvedValue({ data: null, source: "error" });
    render(<OnboardingDetail id="c1" />);
    await waitFor(() => expect(screen.getByText(/couldn.t load/i)).toBeInTheDocument());
    expect(screen.getByText(/couldn't be loaded/i)).toBeInTheDocument();
  });

  // GAP-CRM-ONBOARDING-DETAIL-01: the case is named by its customer/deal, and
  // Account/Deal render as links with names, not raw UUIDs.
  it("names the customer and links Account/Deal instead of showing raw UUIDs", async () => {
    vi.mocked(onb.getOnboardingCase).mockResolvedValue({
      data: caseAt("verification", "submitted"),
      source: "api",
    });
    vi.mocked(onb.getOnboardingLookups).mockResolvedValue({
      dealNames: { d1: "Acme renewal" },
      accountNames: { a1: "Acme Corp" },
    });
    render(<OnboardingDetail id="c1" />);
    await waitFor(() => expect(screen.getByText(/Onboarding — Acme renewal/)).toBeInTheDocument());
    const accountLink = screen.getByRole("link", { name: "Acme Corp" });
    expect(accountLink).toHaveAttribute("href", "/crm/accounts/a1");
    const dealLink = screen.getByRole("link", { name: "Acme renewal" });
    expect(dealLink).toHaveAttribute("href", "/crm/deals/d1");
    // The raw ids are not the heading / not shown as the Account/Deal value.
    expect(screen.queryByText(/^Case /)).not.toBeInTheDocument();
  });

  // GAP-CRM-ONBOARDING-DETAIL-03: verified/rejected are approver-only. A
  // non-approver sees only "Submitted"; an approver sees all three.
  it("hides verified/rejected KYC outcomes from a non-approver", async () => {
    vi.mocked(onb.getOnboardingCase).mockResolvedValue({
      data: caseAt("initiated", "pending"),
      source: "api",
    });
    render(<OnboardingDetail id="c1" canApproveKyc={false} />);
    const select = await screen.findByLabelText(/new kyc outcome/i);
    const options = within(select).getAllByRole("option").map((o) => o.textContent);
    // pending → submitted is the only non-approver move; verified/rejected are
    // only reachable from "submitted" and are approver-only, so even there a
    // non-approver would see an empty option set.
    expect(options).toContain("Submitted");
    expect(options).not.toContain("Verified");
    expect(options).not.toContain("Rejected");
  });

  it("offers verified and rejected to an approver", async () => {
    vi.mocked(onb.getOnboardingCase).mockResolvedValue({
      data: caseAt("documents_submitted", "submitted"),
      source: "api",
    });
    render(<OnboardingDetail id="c1" canApproveKyc />);
    const select = await screen.findByLabelText(/new kyc outcome/i);
    const options = within(select).getAllByRole("option").map((o) => o.textContent);
    expect(options).toContain("Verified");
    expect(options).toContain("Rejected");
  });

  // GAP-CRM-ONBOARDING-DETAIL-02: a verified outcome requires a reference.
  it("blocks a verified outcome with no reference and does not call recordKyc", async () => {
    vi.mocked(onb.getOnboardingCase).mockResolvedValue({
      data: caseAt("documents_submitted", "submitted"),
      source: "api",
    });
    render(<OnboardingDetail id="c1" canApproveKyc />);
    fireEvent.change(await screen.findByLabelText(/new kyc outcome/i), { target: { value: "verified" } });
    fireEvent.click(screen.getByRole("button", { name: /record kyc outcome/i }));
    expect(await screen.findByText(/reference is required/i)).toBeInTheDocument();
    expect(onb.recordKyc).not.toHaveBeenCalled();
  });

  // GAP-CRM-ONBOARDING-DETAIL-04: a failed load offers a working Retry.
  it("offers Retry on a failed load and re-fetches when clicked", async () => {
    vi.mocked(onb.getOnboardingCase)
      .mockResolvedValueOnce({ data: null, source: "error" })
      .mockResolvedValue({ data: caseAt("verification", "submitted"), source: "api" });
    render(<OnboardingDetail id="c1" />);
    const retry = await screen.findByRole("button", { name: /try again/i });
    fireEvent.click(retry);
    await waitFor(() => expect(screen.getByText(/Onboarding — Unnamed case/)).toBeInTheDocument());
    expect(onb.getOnboardingCase).toHaveBeenCalledTimes(2);
  });

  // GAP-CRM-ONBOARDING-DETAIL-05 / F1-03 + F1-06: the KYC reference is masked
  // SERVER-SIDE (last 4) for everyone except the KYC approver roles. The page
  // renders whatever the server returned — no client masking.
  it("renders the server-masked KYC reference (all but last 4) for a non-approver", async () => {
    const withRef = { ...caseAt("verification", "verified"), kycReference: "••••7890" };
    vi.mocked(onb.getOnboardingCase).mockResolvedValue({ data: withRef, source: "api" });
    render(<OnboardingDetail id="c1" />);
    await waitFor(() => expect(screen.getByText("••••7890")).toBeInTheDocument());
    expect(screen.queryByText("1234567890")).not.toBeInTheDocument();
  });

  it("renders the clear KYC reference for a KYC approver (server sends the clear value)", async () => {
    const withRef = { ...caseAt("verification", "verified"), kycReference: "KYC-REF-1234567890" };
    vi.mocked(onb.getOnboardingCase).mockResolvedValue({ data: withRef, source: "api" });
    render(<OnboardingDetail id="c1" canApproveKyc />);
    await waitFor(() => expect(screen.getByText("KYC-REF-1234567890")).toBeInTheDocument());
  });

  // GAP-CRM-ONBOARDING-DETAIL-07: the raw version number is no longer shown in
  // the visible grid (it is still used internally for the optimistic lock —
  // proven by the version:2 asserted on the advance/kyc calls above).
  it("does not show the raw Version field in the grid", async () => {
    vi.mocked(onb.getOnboardingCase).mockResolvedValue({ data: caseAt("verification", "submitted"), source: "api" });
    render(<OnboardingDetail id="c1" />);
    await waitFor(() => expect(screen.getByText(/Onboarding —/)).toBeInTheDocument());
    // The "Version" field label is gone from the detail grid.
    expect(screen.queryByText("Version")).not.toBeInTheDocument();
  });

  // GAP-CRM-ONBOARDING-DETAIL-06: an accepted (202) change is applied
  // asynchronously; the detail polls until the version advances rather than
  // reloading once into a stale read, and shows a Pending banner meanwhile.
  it("polls after a 202 until the version advances, then settles", { timeout: 20000 }, async () => {
    vi.mocked(onb.getOnboardingCase)
      // initial load
      .mockResolvedValueOnce({ data: caseAt("initiated", "pending"), source: "api" })
      // first poll: still the OLD version (stale)
      .mockResolvedValueOnce({ data: caseAt("initiated", "pending"), source: "api" })
      // second poll: version advanced + stage changed
      .mockResolvedValue({ data: { ...caseAt("documents_submitted", "pending"), version: 3 }, source: "api" });
    vi.mocked(onb.advanceStage).mockResolvedValue({ accepted: true });

    render(<OnboardingDetail id="c1" />);
    fireEvent.change(await screen.findByLabelText(/move to/i), { target: { value: "documents_submitted" } });
    fireEvent.click(screen.getByRole("button", { name: /apply stage change/i }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /confirm change/i }));

    await waitFor(() => expect(onb.advanceStage).toHaveBeenCalled());
    // Pending banner appears while polling.
    expect(await screen.findByText(/Pending update/i)).toBeInTheDocument();
    // After the two 2s poll intervals the change lands: banner gone, success shown.
    await waitFor(() => expect(screen.queryByText(/Pending update/i)).not.toBeInTheDocument(), { timeout: 15000 });
    expect(screen.getByText(/Case moved to "Documents submitted"/i)).toBeInTheDocument();
    // Three getOnboardingCase calls: initial + 2 polls.
    expect(vi.mocked(onb.getOnboardingCase).mock.calls.length).toBeGreaterThanOrEqual(3);
  });
});
