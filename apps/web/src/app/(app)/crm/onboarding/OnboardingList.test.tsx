import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { OnboardingList } from "./OnboardingList";
import * as onb from "@/lib/crm/onboarding";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

function withIntl(ui: React.ReactElement) {
  return (
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {ui}
    </NextIntlClientProvider>
  );
}

vi.mock("@/lib/crm/onboarding", async (orig) => {
  const actual = await orig<typeof import("@/lib/crm/onboarding")>();
  return { ...actual, getOnboardingCases: vi.fn(), getOnboardingLookups: vi.fn() };
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
    accountName: null,
    dealName: null,
  },
];

const noLookups: onb.OnboardingLookups = { dealNames: {}, accountNames: {} };

beforeEach(() => {
  vi.mocked(onb.getOnboardingCases).mockReset();
  vi.mocked(onb.getOnboardingLookups).mockReset();
  vi.mocked(onb.getOnboardingLookups).mockResolvedValue(noLookups);
});

describe("OnboardingList (P1-9)", () => {
  it("renders cases with stage + KYC labels", async () => {
    vi.mocked(onb.getOnboardingCases).mockResolvedValue({ data: cases, source: "api" });
    render(withIntl(<OnboardingList />));
    await waitFor(() => expect(screen.getByText(/Verification/)).toBeInTheDocument());
    expect(screen.getByText(/Submitted/)).toBeInTheDocument();
    // links to the detail page
    expect(screen.getByRole("link")).toHaveAttribute("href", `/crm/onboarding/${cases[0].id}`);
  });

  // GAP-CRM-ONBOARDING-01 — a row must be identified by its customer/deal name,
  // not an 8-char UUID fragment. The old primary identifier was `shortId(c.id)`
  // ("11111111…"); this asserts the deal name is now the link text and the
  // raw UUID fragment is no longer the row's primary identifier.
  it("identifies a row by its resolved deal name, not a UUID fragment", async () => {
    vi.mocked(onb.getOnboardingCases).mockResolvedValue({ data: cases, source: "api" });
    vi.mocked(onb.getOnboardingLookups).mockResolvedValue({
      dealNames: { d1: "Acme Corp renewal" },
      accountNames: { a1: "Acme Corp" },
    });
    render(withIntl(<OnboardingList />));
    await waitFor(() => expect(screen.getByRole("link", { name: "Acme Corp renewal" })).toBeInTheDocument());
    expect(screen.getByRole("link", { name: "Acme Corp renewal" })).toHaveAttribute(
      "href",
      `/crm/onboarding/${cases[0].id}`,
    );
    // Account shows the name, not the id fragment.
    expect(screen.getByText("Acme Corp")).toBeInTheDocument();
    // The 8-char UUID fragment is never the primary identifier (link text).
    expect(screen.queryByRole("link", { name: /^11111111…$/ })).not.toBeInTheDocument();
  });

  it("passes the stage filter to the loader", async () => {
    vi.mocked(onb.getOnboardingCases).mockResolvedValue({ data: cases, source: "api" });
    render(withIntl(<OnboardingList />));
    await waitFor(() => expect(onb.getOnboardingCases).toHaveBeenCalledWith({}));
    fireEvent.change(screen.getByLabelText(/stage/i), { target: { value: "provisioning" } });
    await waitFor(() =>
      expect(onb.getOnboardingCases).toHaveBeenLastCalledWith({ stage: "provisioning" }),
    );
  });

  it("shows an empty state on an ok-but-empty result (never fabricated as error)", async () => {
    vi.mocked(onb.getOnboardingCases).mockResolvedValue({ data: [], source: "api" });
    render(withIntl(<OnboardingList />));
    await waitFor(() => expect(screen.getByText(/No onboarding cases/i)).toBeInTheDocument());
    expect(screen.queryByText(/couldn.t load/i)).not.toBeInTheDocument();
  });

  it("shows the saved-info badge on a load error, not a fake empty list", async () => {
    vi.mocked(onb.getOnboardingCases).mockResolvedValue({ data: [], source: "error" });
    render(withIntl(<OnboardingList />));
    await waitFor(() => expect(screen.getAllByText(/couldn.t load/i).length).toBeGreaterThan(0));
    expect(screen.getByText(/couldn't be loaded/i)).toBeInTheDocument();
    expect(screen.queryByText(/No onboarding cases/i)).not.toBeInTheDocument();
  });
});
