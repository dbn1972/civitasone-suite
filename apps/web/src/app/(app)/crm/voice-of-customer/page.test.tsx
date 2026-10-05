import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("../../../_data/loaders", () => ({
  getCrmSentimentSummary: vi.fn(),
}));
vi.mock("./ThemeTable", () => ({
  ThemeTable: () => <div data-testid="theme-table">Nothing scored yet</div>,
}));
vi.mock("../../../_components/DataSourceBadge", () => ({
  DataSourceBadge: ({ source }: { source: string }) =>
    source === "error" ? <div>Couldn't load — showing nothing</div> : null,
}));
// PeriodFilter and RefreshErrorState use next/navigation client hooks.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => "/crm/voice-of-customer",
  useSearchParams: () => new URLSearchParams(),
}));

import VoiceOfCitizenPage from "./page";
import { getCrmSentimentSummary } from "../../../_data/loaders";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

function withIntl(ui: React.ReactElement) {
  return (
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {ui}
    </NextIntlClientProvider>
  );
}

const mockedSummary = vi.mocked(getCrmSentimentSummary);

const mockSummaryData = {
  data: {
    total: 100,
    negativeShare: 20,
    averageScore: 72,
    byPolarity: { positive: 60, neutral: 20, negative: 20 },
    themes: [{ theme: "service_quality", count: 30, negativeCount: 5 }],
    truncated: false,
  },
  source: "api" as const,
};

beforeEach(() => {
  mockedSummary.mockReset();
  mockedSummary.mockResolvedValue(mockSummaryData);
});

describe("VoiceOfCitizenPage — GoI redesign", () => {
  it("renders Voice of Citizen heading (not Voice of Customer)", async () => {
    render(withIntl(await VoiceOfCitizenPage({})));
    expect(screen.getByText("Voice of Citizen")).toBeInTheDocument();
    expect(screen.queryByText("Voice of Customer")).not.toBeInTheDocument();
  });

  it("renders DPDP notice with DPDP Act 2023 reference", async () => {
    render(withIntl(await VoiceOfCitizenPage({})));
    const notice = screen.getByRole("note", { name: /data protection notice/i });
    expect(notice).toBeInTheDocument();
    expect(notice).toHaveTextContent(/DPDP Act 2023/);
    expect(notice).toHaveTextContent(/anonymised/i);
  });

  it("renders Key Feedback Themes card heading (not What They Are Talking About)", async () => {
    render(withIntl(await VoiceOfCitizenPage({})));
    expect(screen.getByText("Key Feedback Themes")).toBeInTheDocument();
    expect(
      screen.queryByText("What They Are Talking About"),
    ).not.toBeInTheDocument();
  });

  it("renders Primary Concern stat label (not Top Concern)", async () => {
    render(withIntl(await VoiceOfCitizenPage({})));
    expect(screen.getByText("Primary Concern")).toBeInTheDocument();
    expect(screen.queryByText("Top Concern")).not.toBeInTheDocument();
  });

  it("renders ThemeTable component", async () => {
    render(withIntl(await VoiceOfCitizenPage({})));
    expect(screen.getByTestId("theme-table")).toBeInTheDocument();
  });

  it("shows DataSourceBadge when source is error", async () => {
    mockedSummary.mockResolvedValue({
      ...mockSummaryData,
      source: "error" as const,
    });
    render(withIntl(await VoiceOfCitizenPage({})));
    expect(screen.getByText("Couldn't load — showing nothing")).toBeInTheDocument();
  });

  // GAP-CRM-VOICE-OF-CUSTOMER-01: the page now forwards from/to to the loader
  // so the aggregate is recomputed server-side for the chosen window.
  it("passes the ?from/?to window to the loader", async () => {
    render(withIntl(await VoiceOfCitizenPage({ searchParams: { from: "2026-09-01", to: "2026-09-30" } })));
    expect(mockedSummary).toHaveBeenCalledWith({ from: "2026-09-01", to: "2026-09-30" });
    expect(screen.getByText(/Window: 2026-09-01 to 2026-09-30/)).toBeInTheDocument();
  });

  // Invalid (inverted) range must NOT be sent to the server; show a note and the
  // full aggregate instead.
  it("drops an inverted range (from > to), warns, and loads all activity", async () => {
    render(withIntl(await VoiceOfCitizenPage({ searchParams: { from: "2026-09-30", to: "2026-09-01" } })));
    expect(mockedSummary).toHaveBeenCalledWith({});
    expect(screen.getByRole("alert")).toHaveTextContent(/isn.t valid/i);
  });

  // GAP-CRM-VOICE-OF-CUSTOMER-02 (FAILMASK): on error the themes card must show a
  // Retry affordance, NOT the "Nothing scored yet / Log an interaction" empty
  // state that pushes staff to fabricate data.
  it("on error, the themes card offers Retry and never the empty 'Nothing scored yet' state", async () => {
    mockedSummary.mockResolvedValue({ ...mockSummaryData, source: "error" as const });
    render(withIntl(await VoiceOfCitizenPage({})));
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
    expect(screen.queryByTestId("theme-table")).not.toBeInTheDocument();
    expect(screen.queryByText(/nothing scored yet/i)).not.toBeInTheDocument();
  });

  // The empty state is still correct when the load SUCCEEDS with no themes.
  it("keeps the ThemeTable (empty state) when the load succeeds with no themes", async () => {
    mockedSummary.mockResolvedValue({
      ...mockSummaryData,
      data: { ...mockSummaryData.data, themes: [] },
      source: "api" as const,
    });
    render(withIntl(await VoiceOfCitizenPage({})));
    expect(screen.getByTestId("theme-table")).toBeInTheDocument();
  });
});
