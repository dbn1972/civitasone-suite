import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import { NbaTable } from "./NbaTable";
import type { NbaScoreRow } from "../_data";

const rows: NbaScoreRow[] = [
  {
    id: "3f2a9c1e-1111-4000-8000-000000000001",
    subject: "account-9",
    subjectType: "account",
    model: "churn",
    score: "0.8700",
    confidence: "0.9100",
    computedAt: "2026-02-01T00:00:00.000Z",
  },
];

describe("NbaTable (GAP-RECOMMENDATIONS-NBA-02/03)", () => {
  it("renders a payload with subject/model/score under named columns, not an 8-char id", () => {
    render(<NbaTable rows={rows} />);
    expect(screen.getByRole("columnheader", { name: "Subject" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Model" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /Score/ })).toBeInTheDocument();
    expect(screen.getByText("account-9")).toBeInTheDocument();
    expect(screen.getByText("churn")).toBeInTheDocument();
    expect(screen.getByText("0.8700")).toBeInTheDocument();
    // The 8-char id prefix the old generic table showed must NOT appear.
    expect(screen.queryByText("3f2a9c1e")).not.toBeInTheDocument();
  });

  it("renders an empty state when there are no scores", () => {
    render(<NbaTable rows={[]} />);
    expect(screen.getByText(/No predictive scores/i)).toBeInTheDocument();
  });
});

describe("NbaTable — Subject column shortens an opaque UUID (GAP2-RECOMMENDATIONS-NBA-04)", () => {
  const FULL_UUID = "ab12cd34-5678-4abc-9def-0123456789ab";
  const uuidRow: NbaScoreRow = {
    id: "s-uuid",
    subject: FULL_UUID,
    subjectType: "account",
    model: "churn",
    score: "0.9100",
    confidence: "0.8000",
    computedAt: null,
  };

  it("renders a full 36-char UUID as a short labelled reference, not the raw UUID", () => {
    render(<NbaTable rows={[uuidRow]} />);
    expect(screen.getByText("#ab12cd34")).toBeInTheDocument();
    expect(screen.queryByText(FULL_UUID)).not.toBeInTheDocument();
  });

  it("keeps the full id available as a tooltip", () => {
    render(<NbaTable rows={[uuidRow]} />);
    expect(screen.getByText("#ab12cd34").getAttribute("title")).toBe(FULL_UUID);
  });
});
