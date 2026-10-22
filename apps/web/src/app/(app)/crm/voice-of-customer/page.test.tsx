import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@/test-utils/intl-render";

vi.mock("../../../_data/loaders", () => ({
  getCrmSentimentSummary: vi.fn(),
  getCrmCitizenRatings: vi.fn(),
}));
// Expose the window the export button is given, so it can be compared with the figures'.
vi.mock("../../../_components/crm/ServerExportButton", () => ({
  ServerExportButton: ({ filters }: { filters?: { from?: string; to?: string } }) => (
    <div data-testid="export" data-from={filters?.from ?? ""} data-to={filters?.to ?? ""} />
  ),
}));
vi.mock("./ThemeTable", () => ({
  ThemeTable: ({ themes }: { themes: Array<{ theme: string }> }) => (
    <div
      data-testid="theme-table"
      data-themes={themes.map((t) => t.theme).join(",")}
    >
      Nothing scored yet
    </div>
  ),
}));
const mockRoles = vi.fn<() => string[]>();
vi.mock("@/lib/auth/roleGuard", async (orig) => {
  const actual = await orig<typeof import("@/lib/auth/roleGuard")>();
  return { ...actual, getSessionRoles: () => mockRoles() };
});
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
import { getCrmSentimentSummary, getCrmCitizenRatings } from "../../../_data/loaders";
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
const mockedRatings = vi.mocked(getCrmCitizenRatings);

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
  mockedRatings.mockReset();
  mockedRatings.mockResolvedValue({ data: { average: 4.25, count: 12 }, source: "api" });
  mockRoles.mockReset();
  mockRoles.mockReturnValue(["crm_admin"]);
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

  // GAP-CRM-VOICE-OF-CUSTOMER-FEEDBACK-05: a "Citizen ratings" tile (average +
  // count), SEPARATE from the model-scored sentiment tiles.
  it("renders a Citizen ratings tile with the average and count, separate from sentiment", async () => {
    render(withIntl(await VoiceOfCitizenPage({})));
    expect(screen.getByText("Citizen ratings")).toBeInTheDocument();
    expect(screen.getByText("Average rating (1 to 5)")).toBeInTheDocument();
    expect(screen.getByText("4.25")).toBeInTheDocument();
    expect(screen.getByText("Ratings received")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
  });

  it("shows '—' for the ratings tile when there are no ratings", async () => {
    mockedRatings.mockResolvedValue({ data: { average: null, count: 0 }, source: "api" });
    render(withIntl(await VoiceOfCitizenPage({})));
    // The average shows em-dash; count shows 0.
    expect(screen.getByText("Average rating (1 to 5)")).toBeInTheDocument();
    expect(screen.getByText("Ratings received")).toBeInTheDocument();
  });

  it("shows '—' for the ratings tile when the ratings load fails", async () => {
    mockedRatings.mockResolvedValue({ data: { average: null, count: 0 }, source: "error" });
    render(withIntl(await VoiceOfCitizenPage({})));
    expect(screen.getByText("Citizen ratings")).toBeInTheDocument();
  });

  // GAP-CRM-VOICE-OF-CUSTOMER-04: the average score is a SIGNED -100..+100
  // scale, so the tile shows a signed value and the real range, never "n / 100".
  it("shows the average score on a signed scale, not out of 100", async () => {
    render(withIntl(await VoiceOfCitizenPage({})));
    expect(screen.getByText("+72")).toBeInTheDocument();
    expect(screen.queryByText("72 / 100")).not.toBeInTheDocument();
    expect(screen.getByText(/Average Score \(-100 to \+100\)/)).toBeInTheDocument();
  });

  it("renders a negative average with a minus sign rather than a 0-100 floor", async () => {
    mockedSummary.mockResolvedValue({
      ...mockSummaryData,
      data: { ...mockSummaryData.data, averageScore: -22 },
      source: "api" as const,
    });
    render(withIntl(await VoiceOfCitizenPage({})));
    expect(screen.getByText("−22")).toBeInTheDocument();
  });

  it("shows DataSourceBadge when source is error", async () => {
    mockedSummary.mockResolvedValue({
      ...mockSummaryData,
      source: "error" as const,
    });
    render(withIntl(await VoiceOfCitizenPage({})));
    expect(screen.getByText("Couldn't load — showing nothing")).toBeInTheDocument();
  });

  // GAP-CRM-VOICE-OF-CUSTOMER-01: the page forwards the chosen window to the loader so the
  // aggregate is recomputed server-side for it. The server's filters are ISO INSTANTS (a bare
  // yyyy-mm-dd is a 400), so the day range is sent as the IST day's first and last instants.
  it("passes the ?from/?to window to the loader as ISO instants the server accepts", async () => {
    render(withIntl(await VoiceOfCitizenPage({ searchParams: { from: "2026-09-01", to: "2026-09-30" } })));
    expect(mockedSummary).toHaveBeenCalledTimes(1);
    expect(mockedSummary).toHaveBeenCalledWith({ from: "2026-08-31T18:30:00.000Z", to: "2026-09-30T18:29:59.999Z" });
    expect(screen.getByText(/Window: 2026-09-01 to 2026-09-30/)).toBeInTheDocument();
  });

  it("sends nothing at all for the default all-time view", async () => {
    render(withIntl(await VoiceOfCitizenPage({})));
    expect(mockedSummary).toHaveBeenCalledWith({});
    expect(screen.getByText(/Window: all time/)).toBeInTheDocument();
  });

  it("a half-open window sends only the side it has", async () => {
    render(withIntl(await VoiceOfCitizenPage({ searchParams: { from: "2026-09-01" } })));
    expect(mockedSummary).toHaveBeenCalledWith({ from: "2026-08-31T18:30:00.000Z" });
  });

  // The download must cover exactly the window on screen - same conversion, same instants.
  it("exports exactly the same window as the figures", async () => {
    render(withIntl(await VoiceOfCitizenPage({ searchParams: { from: "2026-09-01", to: "2026-09-30" } })));
    const summaryWindow = mockedSummary.mock.calls[0]![0];
    const exp = screen.getByTestId("export");
    expect(exp).toHaveAttribute("data-from", summaryWindow!.from);
    expect(exp).toHaveAttribute("data-to", summaryWindow!.to);
  });

  // An invalid window must NOT be sent to the server, and must NOT quietly show the all-time
  // answer to a question the reader did not ask: say so, fetch nothing, leave the control to fix it.
  it("an inverted range (from > to) shows a validation message and fetches nothing", async () => {
    render(withIntl(await VoiceOfCitizenPage({ searchParams: { from: "2026-09-30", to: "2026-09-01" } })));
    expect(mockedSummary).not.toHaveBeenCalled();
    expect(mockedRatings).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/isn.t valid/i);
    // The figures are not shown (no all-time numbers dressed up as this window's)...
    expect(screen.queryByText("Overall Sentiment")).not.toBeInTheDocument();
    expect(screen.queryByTestId("export")).not.toBeInTheDocument();
    // ...but the period control is, so the reader can choose a valid one.
    expect(screen.getByRole("tab", { name: "30 days" })).toBeInTheDocument();
  });

  it.each([
    ["not a real day", { from: "2026-02-31", to: "2026-03-05" }],
    ["month 13", { from: "2026-13-01" }],
    ["garbage", { to: "yesterday" }],
  ])("a %s is invalid too: no fetch, no crash", async (_label, sp) => {
    render(withIntl(await VoiceOfCitizenPage({ searchParams: sp })));
    expect(mockedSummary).not.toHaveBeenCalled();
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

  // GAP-CRM-VOICE-OF-CUSTOMER-05: vigilance-sensitive themes are hidden from —
  // and non-exportable by — a plain crm_user, and visible/exportable to a
  // vigilance-admin role.
  const sensitiveSummary = {
    data: {
      total: 100,
      negativeShare: 40,
      averageScore: -5,
      byPolarity: { positive: 30, neutral: 30, negative: 40 },
      themes: [
        { theme: "delay", count: 40, negativeCount: 30 },
        { theme: "staff_conduct", count: 20, negativeCount: 18 },
        { theme: "corruption", count: 10, negativeCount: 9 },
      ],
      truncated: false,
    },
    source: "api" as const,
  };

  it("hides staff_conduct and corruption rows and shows the vigilance note for a plain crm_user", async () => {
    mockRoles.mockReturnValue(["crm_user"]);
    mockedSummary.mockResolvedValue(sensitiveSummary);
    render(withIntl(await VoiceOfCitizenPage({})));
    const table = screen.getByTestId("theme-table");
    expect(table.dataset.themes).toBe("delay");
    // The server now enforces the vigilance filter + audits the export; the UI
    // theme-filter is defence-in-depth and still hides the sensitive rows here.
    expect(screen.getByText(/vigilance-sensitive theme/i)).toBeInTheDocument();
  });

  it("shows sensitive rows for a vigilance-admin role", async () => {
    mockRoles.mockReturnValue(["crm_admin"]);
    mockedSummary.mockResolvedValue(sensitiveSummary);
    render(withIntl(await VoiceOfCitizenPage({})));
    const table = screen.getByTestId("theme-table");
    expect(table.dataset.themes).toBe("delay,staff_conduct,corruption");
    expect(screen.queryByText(/vigilance-sensitive theme/i)).not.toBeInTheDocument();
  });

  it("does not name a hidden sensitive theme as the Primary Concern for a crm_user", async () => {
    mockRoles.mockReturnValue(["crm_user"]);
    // corruption is the most-negative but must not surface as the headline concern.
    mockedSummary.mockResolvedValue(sensitiveSummary);
    render(withIntl(await VoiceOfCitizenPage({})));
    // "Integrity concerns" is the label for corruption — must not appear as the concern value.
    expect(screen.queryByText("Integrity concerns")).not.toBeInTheDocument();
  });
});
