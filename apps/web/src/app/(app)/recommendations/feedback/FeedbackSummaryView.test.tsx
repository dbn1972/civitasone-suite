import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import { FeedbackSummaryView } from "./FeedbackSummaryView";
import type { FeedbackSummary } from "../_data";

const summary: FeedbackSummary = {
  totalRejections: 7,
  uncodedRejections: 2,
  byReason: [
    { reasonCode: "not_relevant", count: 3 },
    { reasonCode: "already_offered", count: 2 },
    { reasonCode: "price", count: 0 },
  ],
};

describe("FeedbackSummaryView (GAP-RECOMMENDATIONS-FEEDBACK-01/02)", () => {
  it("shows aggregate counts, not a raw event list", () => {
    render(<FeedbackSummaryView summary={summary} />);
    expect(screen.getByText("Total rejections")).toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument();
    expect(screen.getByText("Uncoded rejections")).toBeInTheDocument();
  });

  it("lists only reason codes with a non-zero count, humanized", () => {
    render(<FeedbackSummaryView summary={summary} />);
    expect(screen.getByText("Not Relevant")).toBeInTheDocument();
    expect(screen.getByText("Already Offered")).toBeInTheDocument();
    // zero-count code is filtered out
    expect(screen.queryByText("Price")).not.toBeInTheDocument();
  });

  it("shows an empty state when nothing has been rejected", () => {
    render(
      <FeedbackSummaryView summary={{ totalRejections: 0, uncodedRejections: 0, byReason: [] }} />,
    );
    expect(screen.getByText(/No rejection reasons yet/i)).toBeInTheDocument();
  });
});
