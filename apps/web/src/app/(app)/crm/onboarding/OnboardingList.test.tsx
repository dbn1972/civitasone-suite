import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { OnboardingList } from "./OnboardingList";
import * as onb from "@/lib/crm/onboarding";

vi.mock("@/lib/crm/onboarding", async (orig) => {
  const actual = await orig<typeof import("@/lib/crm/onboarding")>();
  return { ...actual, getOnboardingCases: vi.fn() };
});

const cases: onb.OnboardingCase[] = [
  {
    id: "11111111-1111-1111-1111-111111111111",
    dealId: "d1",
    accountId: "a1",
    stage: "verification",
    kycStatus: "submitted",
    kycReference: null,
    kycVerifiedAt: null,
    completedAt: null,
    cancellationReason: null,
    createdAt: "2026-08-01T00:00:00Z",
    updatedAt: "2026-08-02T00:00:00Z",
    version: 1,
  },
];

beforeEach(() => vi.mocked(onb.getOnboardingCases).mockReset());

describe("OnboardingList (P1-9)", () => {
  it("renders cases with stage + KYC labels", async () => {
    vi.mocked(onb.getOnboardingCases).mockResolvedValue({ data: cases, source: "api" });
    render(<OnboardingList />);
    await waitFor(() => expect(screen.getByText(/Verification/)).toBeInTheDocument());
    expect(screen.getByText(/Submitted/)).toBeInTheDocument();
    // links to the detail page
    expect(screen.getByRole("link")).toHaveAttribute("href", `/crm/onboarding/${cases[0].id}`);
  });

  it("passes the stage filter to the loader", async () => {
    vi.mocked(onb.getOnboardingCases).mockResolvedValue({ data: cases, source: "api" });
    render(<OnboardingList />);
    await waitFor(() => expect(onb.getOnboardingCases).toHaveBeenCalledWith({}));
    fireEvent.change(screen.getByLabelText(/stage/i), { target: { value: "provisioning" } });
    await waitFor(() =>
      expect(onb.getOnboardingCases).toHaveBeenLastCalledWith({ stage: "provisioning" }),
    );
  });

  it("shows an empty state on an ok-but-empty result (never fabricated as error)", async () => {
    vi.mocked(onb.getOnboardingCases).mockResolvedValue({ data: [], source: "api" });
    render(<OnboardingList />);
    await waitFor(() => expect(screen.getByText(/No onboarding cases/i)).toBeInTheDocument());
    expect(screen.queryByText(/showing saved information/i)).not.toBeInTheDocument();
  });

  it("shows the saved-info badge on a load error, not a fake empty list", async () => {
    vi.mocked(onb.getOnboardingCases).mockResolvedValue({ data: [], source: "error" });
    render(<OnboardingList />);
    await waitFor(() => expect(screen.getAllByText(/showing saved information/i).length).toBeGreaterThan(0));
    expect(screen.getByText(/couldn't be loaded/i)).toBeInTheDocument();
    expect(screen.queryByText(/No onboarding cases/i)).not.toBeInTheDocument();
  });
});
