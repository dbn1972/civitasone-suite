import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import { ApplicationPipeline } from "./ApplicationPipeline";

const renderPipeline = (stages: string[]) =>
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <ApplicationPipeline applications={stages.map((stage) => ({ stage }))} activeStage="all" onStageClick={vi.fn()} />
    </NextIntlClientProvider>,
  );

const counts = () => screen.getAllByRole("button").map((b) => b.getAttribute("aria-label"));

describe("ApplicationPipeline (GAP-RECRUITMENT-DETAIL-02)", () => {
  it("renders only stages the backend can produce: no Interview column", () => {
    renderPipeline(["applied", "shortlisted"]);
    expect(counts()).toEqual([
      "Received: 1 applications. Click to filter.",
      "Shortlisted: 1 applications. Click to filter.",
      "Offer: 0 applications. Click to filter.",
      "Joined: 0 applications. Click to filter.",
    ]);
    expect(screen.queryByText("Interview")).not.toBeInTheDocument();
  });

  it("counts add up to the active (non-rejected, non-withdrawn) total, including selected", () => {
    const stages = ["applied", "applied", "shortlisted", "selected", "offered", "hired", "rejected", "withdrawn"];
    renderPipeline(stages);
    const total = counts().map((l) => Number(/: (\d+) /.exec(l ?? "")?.[1])).reduce((a, b) => a + b, 0);
    expect(total).toBe(stages.filter((s) => s !== "rejected" && s !== "withdrawn").length);
    expect(screen.getByText("Selected")).toBeInTheDocument();
  });

  it("adds no Selected column when nothing is selected", () => {
    renderPipeline(["applied"]);
    expect(screen.queryByText("Selected")).not.toBeInTheDocument();
  });
});
