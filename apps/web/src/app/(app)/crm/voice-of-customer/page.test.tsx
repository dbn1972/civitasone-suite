import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("../../../_data/loaders", () => ({
  getCrmSentimentSummary: vi.fn(),
}));
vi.mock("./ThemeTable", () => ({
  ThemeTable: () => <div data-testid="theme-table" />,
}));
vi.mock("../../../_components/DataSourceBadge", () => ({
  DataSourceBadge: ({ source }: { source: string }) =>
    source === "error" ? <div>Showing saved information</div> : null,
}));

import VoiceOfCitizenPage from "./page";
import { getCrmSentimentSummary } from "../../../_data/loaders";

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
    render(await VoiceOfCitizenPage());
    expect(screen.getByText("Voice of Citizen")).toBeInTheDocument();
    expect(screen.queryByText("Voice of Customer")).not.toBeInTheDocument();
  });

  it("renders DPDP notice with DPDP Act 2023 reference", async () => {
    render(await VoiceOfCitizenPage());
    const notice = screen.getByRole("note", { name: /data protection notice/i });
    expect(notice).toBeInTheDocument();
    expect(notice).toHaveTextContent(/DPDP Act 2023/);
    expect(notice).toHaveTextContent(/anonymised/i);
  });

  it("renders Key Feedback Themes card heading (not What They Are Talking About)", async () => {
    render(await VoiceOfCitizenPage());
    expect(screen.getByText("Key Feedback Themes")).toBeInTheDocument();
    expect(
      screen.queryByText("What They Are Talking About"),
    ).not.toBeInTheDocument();
  });

  it("renders Primary Concern stat label (not Top Concern)", async () => {
    render(await VoiceOfCitizenPage());
    expect(screen.getByText("Primary Concern")).toBeInTheDocument();
    expect(screen.queryByText("Top Concern")).not.toBeInTheDocument();
  });

  it("renders ThemeTable component", async () => {
    render(await VoiceOfCitizenPage());
    expect(screen.getByTestId("theme-table")).toBeInTheDocument();
  });

  it("shows DataSourceBadge when source is error", async () => {
    mockedSummary.mockResolvedValue({
      ...mockSummaryData,
      source: "error" as const,
    });
    render(await VoiceOfCitizenPage());
    expect(screen.getByText("Showing saved information")).toBeInTheDocument();
  });
});
