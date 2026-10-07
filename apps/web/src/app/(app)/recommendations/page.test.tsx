import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("./_data", () => ({
  getRecNba: vi.fn(),
  getRecMatrix: vi.fn(),
  getRecHealth: vi.fn(),
  getRecFeedback: vi.fn(),
}));

import { getRecNba, getRecMatrix, getRecHealth, getRecFeedback } from "./_data";
import Page from "./page";

const mNba = vi.mocked(getRecNba);
const mMatrix = vi.mocked(getRecMatrix);
const mHealth = vi.mocked(getRecHealth);
const mFeedback = vi.mocked(getRecFeedback);

describe("recommendations hub page (GAP-RECOMMENDATIONS-HOME-01/02)", () => {
  beforeEach(() => {
    mNba.mockResolvedValue({ data: [{ id: "a" }, { id: "b" }], source: "api" } as never);
    mMatrix.mockResolvedValue({ data: [{ id: "m" }], source: "api" } as never);
    mHealth.mockResolvedValue({ data: [{ id: "h1" }, { id: "h2" }, { id: "h3" }], source: "api" } as never);
    mFeedback.mockResolvedValue({ data: { totalRejections: 4, uncodedRejections: 0, byReason: [] }, source: "api" } as never);
  });

  it("hub copy no longer promises real-time recommendations or churn prediction", async () => {
    render(await Page());
    expect(screen.queryByText(/Real-time recommendations/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/churn prediction/i)).not.toBeInTheDocument();
    // honest, content-matching copy instead
    expect(screen.getByText(/Product affinity rules \(read-only\)/i)).toBeInTheDocument();
  });

  it("shows count badges from the child endpoints", async () => {
    render(await Page());
    expect(screen.getByText("3 at risk")).toBeInTheDocument();
    expect(screen.getByText("4 rejected")).toBeInTheDocument();
    expect(screen.getByText("1 rules")).toBeInTheDocument();
  });

  it("one failed endpoint shows '—' for that tile, not 0, and does not blank the hub", async () => {
    mHealth.mockResolvedValue({ data: [], source: "error" } as never);
    render(await Page());
    expect(screen.getByText("—")).toBeInTheDocument();
    // the other tiles still render
    expect(screen.getByText("Next Best Action")).toBeInTheDocument();
    expect(screen.getByText("Cross-Sell Matrix")).toBeInTheDocument();
  });
});
