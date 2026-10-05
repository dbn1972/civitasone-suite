import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderWithIntl } from "@/lib/testUtils/intl";
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

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: vi.fn() }),
}));

vi.mock("@/lib/crm/onboarding", async (orig) => {
  const actual = await orig<typeof import("@/lib/crm/onboarding")>();
  return { ...actual, getOnboardingCases: vi.fn(), getOnboardingLookups: vi.fn() };
});

function caseOf(partial: Partial<onb.OnboardingCase> & { id: string }): onb.OnboardingCase {
  return {
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
    ...partial,
  };
}

const cases: onb.OnboardingCase[] = [caseOf({ id: "11111111-1111-1111-1111-111111111111" })];

const noLookups: onb.OnboardingLookups = { dealNames: {}, accountNames: {} };

beforeEach(() => {
  pushMock.mockReset();
  vi.mocked(onb.getOnboardingCases).mockReset();
  vi.mocked(onb.getOnboardingLookups).mockReset();
  vi.mocked(onb.getOnboardingLookups).mockResolvedValue(noLookups);
});

describe("OnboardingList (P1-9)", () => {
  it("renders cases with stage + KYC labels", async () => {
    vi.mocked(onb.getOnboardingCases).mockResolvedValue({ data: cases, source: "api" });
    render(withIntl(<OnboardingList />));
    await waitFor(() => expect(screen.getByRole("link", { name: /Unnamed case/ })).toBeInTheDocument());
    // Stage + KYC labels appear in the row (filter options also carry some of
    // these words, so assert at least one occurrence rather than uniqueness).
    expect(screen.getAllByText(/Verification/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Submitted/).length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: /Unnamed case/ })).toHaveAttribute(
      "href",
      `/crm/onboarding/${cases[0].id}`,
    );
  });

  // GAP-CRM-ONBOARDING-01 — a row is identified by its customer/deal name.
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
    expect(screen.getByText("Acme Corp")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /^11111111…$/ })).not.toBeInTheDocument();
  });

  // GAP-CRM-ONBOARDING-02: fetch a full page (<=200) and pass the stage filter.
  it("passes the stage filter and a full page size to the loader", async () => {
    vi.mocked(onb.getOnboardingCases).mockResolvedValue({ data: cases, source: "api" });
    render(withIntl(<OnboardingList />));
    await waitFor(() => expect(onb.getOnboardingCases).toHaveBeenCalledWith({ limit: 200 }));
    fireEvent.change(screen.getByLabelText("Stage"), { target: { value: "provisioning" } });
    await waitFor(() =>
      expect(onb.getOnboardingCases).toHaveBeenLastCalledWith({ stage: "provisioning", limit: 200 }),
    );
  });

  // GAP-CRM-ONBOARDING-02: 150 cases paginate at 25/page.
  it("paginates a long case list at 25 per page", async () => {
    const many = Array.from({ length: 150 }, (_, i) =>
      caseOf({
        id: `${String(i).padStart(8, "0")}-0000-0000-0000-000000000000`,
        dealName: `Deal ${String(i).padStart(3, "0")}`,
      }),
    );
    vi.mocked(onb.getOnboardingCases).mockResolvedValue({ data: many, source: "api" });
    render(withIntl(<OnboardingList />));
    await waitFor(() => expect(screen.getByText(/Page 1 of 6/)).toBeInTheDocument());
    // 25 data rows on the first page.
    const links = screen.getAllByRole("link").filter((a) => a.getAttribute("href")?.startsWith("/crm/onboarding/"));
    expect(links.length).toBe(25);
  });

  // GAP-CRM-ONBOARDING-02: clicking a sortable header reorders rows.
  it("sorts by Updated when the header is activated", async () => {
    const rows = [
      caseOf({ id: "a0000000-0000-0000-0000-000000000000", dealName: "Alpha", updatedAt: "2026-08-01T00:00:00Z" }),
      caseOf({ id: "b0000000-0000-0000-0000-000000000000", dealName: "Bravo", updatedAt: "2026-09-01T00:00:00Z" }),
    ];
    vi.mocked(onb.getOnboardingCases).mockResolvedValue({ data: rows, source: "api" });
    render(withIntl(<OnboardingList />));
    const header = await screen.findByText("Updated");
    fireEvent.click(header);
    await waitFor(() => expect(header.closest("th")).toHaveAttribute("aria-sort", "ascending"));
    fireEvent.click(header);
    expect(header.closest("th")).toHaveAttribute("aria-sort", "descending");
  });

  // GAP-CRM-ONBOARDING-03: KYC filter narrows the rows client-side.
  it("filters rows by KYC status", async () => {
    const rows = [
      caseOf({ id: "a0000000-0000-0000-0000-000000000000", dealName: "Alpha", kycStatus: "submitted" }),
      caseOf({ id: "b0000000-0000-0000-0000-000000000000", dealName: "Bravo", kycStatus: "verified" }),
    ];
    vi.mocked(onb.getOnboardingCases).mockResolvedValue({ data: rows, source: "api" });
    render(withIntl(<OnboardingList />));
    await waitFor(() => expect(screen.getByRole("link", { name: "Alpha" })).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("KYC status"), { target: { value: "submitted" } });
    await waitFor(() => expect(screen.queryByRole("link", { name: "Bravo" })).not.toBeInTheDocument());
    expect(screen.getByRole("link", { name: "Alpha" })).toBeInTheDocument();
    // The loader is NOT re-called for a KYC change (client-side filter only).
    expect(onb.getOnboardingCases).toHaveBeenCalledTimes(1);
  });

  // GAP-CRM-ONBOARDING-03: a case stale in its stage beyond the SLA shows an
  // Overdue pill; a fresh one does not.
  it("flags a case older than the stage SLA as Overdue", async () => {
    const stale = caseOf({
      id: "a0000000-0000-0000-0000-000000000000",
      dealName: "Stale case",
      updatedAt: "2000-01-01T00:00:00Z",
    });
    vi.mocked(onb.getOnboardingCases).mockResolvedValue({ data: [stale], source: "api" });
    render(withIntl(<OnboardingList />));
    await waitFor(() => expect(screen.getByText(/overdue/i)).toBeInTheDocument());
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

  // GAP-CRM-ONBOARDING-04 — on error, exactly ONE data-source badge, plus a
  // working Retry that re-runs the fetch.
  it("renders a single data-source badge and a working Retry on error", async () => {
    vi.mocked(onb.getOnboardingCases)
      .mockResolvedValueOnce({ data: [], source: "error" })
      .mockResolvedValue({ data: cases, source: "api" });
    renderWithIntl(<OnboardingList />);
    const retry = await screen.findByRole("button", { name: /retry/i });
    // Only one data-source badge is rendered (the filter-row one), not two.
    expect(screen.getAllByText(/Couldn't load — showing nothing/i).length).toBe(1);
    fireEvent.click(retry);
    await waitFor(() => expect(screen.getByRole("link", { name: /Unnamed case/ })).toBeInTheDocument());
    expect(onb.getOnboardingCases).toHaveBeenCalledTimes(2);
  });

  // GAP-CRM-ONBOARDING-05 — the Updated cell uses the shared IST "dd Mon yyyy"
  // formatter, not toLocaleString('en-IN') (dd/mm/yyyy with seconds).
  it("formats the Updated date with the shared IST formatter", async () => {
    vi.mocked(onb.getOnboardingCases).mockResolvedValue({
      data: [caseOf({ id: "a0000000-0000-0000-0000-000000000000", dealName: "Alpha", updatedAt: "2026-08-02T06:00:00Z" })],
      source: "api",
    });
    renderWithIntl(<OnboardingList />);
    // "02 Aug 2026, ..." — never the old "02/08/2026, ..:..:.. am" shape.
    await waitFor(() => expect(screen.getByText(/02 Aug 2026/)).toBeInTheDocument());
    expect(screen.queryByText(/02\/08\/2026/)).not.toBeInTheDocument();
  });

  // GAP-CRM-ONBOARDING-06 — stage/KYC render as theme-safe tone pills, not
  // emoji glyphs.
  it("renders stage and KYC as tone pills without emoji glyphs", async () => {
    vi.mocked(onb.getOnboardingCases).mockResolvedValue({
      data: [caseOf({ id: "a0000000-0000-0000-0000-000000000000", dealName: "Alpha", stage: "cancelled", kycStatus: "rejected" })],
      source: "api",
    });
    const { container } = renderWithIntl(<OnboardingList />);
    await waitFor(() => expect(screen.getByRole("link", { name: "Alpha" })).toBeInTheDocument());
    // Pills exist (cancelled → bad, rejected → bad).
    expect(container.querySelectorAll(".pill.bad").length).toBeGreaterThanOrEqual(2);
    // The onboarding emoji glyphs are gone from the rendered output.
    for (const glyph of ["🚫", "⛔", "🆕", "📄"]) {
      expect(container.innerHTML).not.toContain(glyph);
    }
  });
});
