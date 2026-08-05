import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

import { OnboardingDetail } from "./OnboardingDetail";
import * as onb from "@/lib/crm/onboarding";

vi.mock("@/lib/crm/onboarding", async (orig) => {
  const actual = await orig<typeof import("@/lib/crm/onboarding")>();
  return { ...actual, getOnboardingCase: vi.fn(), advanceStage: vi.fn(), recordKyc: vi.fn() };
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
  };
}

beforeEach(() => {
  vi.mocked(onb.getOnboardingCase).mockReset();
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

  it("surfaces the backend 422 KYC-gate reason verbatim (never silent)", async () => {
    // provisioning + verified so the Completed option is enabled and selectable,
    // but the BE still rejects (proves the UI trusts the BE, not just its mirror).
    vi.mocked(onb.getOnboardingCase).mockResolvedValue({ data: caseAt("provisioning", "verified"), source: "api" });
    vi.mocked(onb.advanceStage).mockRejectedValue(
      new Error("KYC_NOT_VERIFIED: onboarding cannot be completed while KYC is 'submitted' — it must be 'verified'"),
    );
    render(<OnboardingDetail id="c1" />);
    fireEvent.change(await screen.findByLabelText(/move to/i), { target: { value: "completed" } });
    fireEvent.click(screen.getByRole("button", { name: /apply stage change/i }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /confirm change/i }));
    expect((await screen.findAllByText(/KYC_NOT_VERIFIED/)).length).toBeGreaterThan(0);
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
    render(<OnboardingDetail id="c1" />);
    fireEvent.change(await screen.findByLabelText(/new kyc outcome/i), { target: { value: "verified" } });
    fireEvent.click(screen.getByRole("button", { name: /record kyc outcome/i }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /record outcome/i }));
    await waitFor(() =>
      expect(onb.recordKyc).toHaveBeenCalledWith("c1", { status: "verified", version: 2 }),
    );
    await waitFor(() => expect(onb.getOnboardingCase).toHaveBeenCalledTimes(2));
  });

  it("shows the saved-info badge when the case fails to load", async () => {
    vi.mocked(onb.getOnboardingCase).mockResolvedValue({ data: null, source: "error" });
    render(<OnboardingDetail id="c1" />);
    await waitFor(() => expect(screen.getByText(/showing saved information/i)).toBeInTheDocument());
    expect(screen.getByText(/couldn't be loaded/i)).toBeInTheDocument();
  });
});
