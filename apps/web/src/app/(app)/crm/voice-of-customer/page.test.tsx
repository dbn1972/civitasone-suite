import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("../../../_data/loaders", () => ({
  getCrmSentimentSummary: vi.fn(),
  getCrmCitizenRatings: vi.fn(),
}));
vi.mock("./ThemeTable", () => ({
  ThemeTable: ({ themes, canExport }: { themes: Array<{ theme: string }>; canExport?: boolean }) => (
    <div
      data-testid="theme-table"
      data-can-export={String(canExport)}
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

  it("hides staff_conduct and corruption rows and disables export for a plain crm_user", async () => {
    mockRoles.mockReturnValue(["crm_user"]);
    mockedSummary.mockResolvedValue(sensitiveSummary);
    render(withIntl(await VoiceOfCitizenPage({})));
    const table = screen.getByTestId("theme-table");
    expect(table.dataset.themes).toBe("delay");
    expect(table.dataset.canExport).toBe("false");
    expect(screen.getByText(/vigilance-sensitive theme/i)).toBeInTheDocument();
  });

  it("shows sensitive rows and allows export for a vigilance-admin role", async () => {
    mockRoles.mockReturnValue(["crm_admin"]);
    mockedSummary.mockResolvedValue(sensitiveSummary);
    render(withIntl(await VoiceOfCitizenPage({})));
    const table = screen.getByTestId("theme-table");
    expect(table.dataset.themes).toBe("delay,staff_conduct,corruption");
    expect(table.dataset.canExport).toBe("true");
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
