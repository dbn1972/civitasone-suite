import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import type { TrainingProgramSummary } from "@civitasone/types";
import { ProgramCard } from "./ProgramCard";

/**
 * Renders through the real next-intl engine (English), matching the
 * established pattern for "use client" components (see e.g.
 * citizen/grievances/GrievancesTable.test.tsx) rather than mocking
 * next-intl -- this exercises the real trainingNew/training message keys
 * this PR adds to en.json too.
 */
function renderCard(overrides: Partial<TrainingProgramSummary> = {}) {
  const program: TrainingProgramSummary = {
    id: "prog-1",
    title: "Some Training",
    category: null,
    mode: null,
    enrollmentDeadline: null,
    startDate: "2026-05-04",
    endDate: "2026-05-06",
    enrolledCount: 2,
    maxCapacity: 10,
    status: "upcoming",
    ...overrides,
  };
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <ProgramCard program={program} />
    </NextIntlClientProvider>,
  );
}

describe("ProgramCard — GAP-HR-TRAINING-01/02/03", () => {
  it("renders no category badge when the API returns category: null (never a guessed 'Mandatory')", () => {
    renderCard({ category: null });
    expect(screen.queryByText(/mandatory/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/optional/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/leadership/i)).not.toBeInTheDocument();
  });

  it("renders the real category label when the API provides one", () => {
    renderCard({ category: "leadership" });
    expect(screen.getByText("Leadership")).toBeInTheDocument();
  });

  it("renders no mode badge when the API returns mode: null, even with venue text that used to trigger the old guess", () => {
    renderCard({ mode: null, venue: "Online Hall" });
    expect(screen.queryByText("Online")).not.toBeInTheDocument();
  });

  it("links Enroll to the programme detail page instead of an inert onEnroll callback", () => {
    renderCard({ id: "prog-42", status: "upcoming", enrolledCount: 0, maxCapacity: 10 });
    const link = screen.getByRole("link", { name: "Enroll" });
    expect(link).toHaveAttribute("href", "/hr/training/prog-42");
  });

  it("shows a whole-day duration, not an hours-between-UTC-midnights figure", () => {
    // Same-day course (2026-05-04 -> 2026-05-04) used to render "< 1 hr".
    renderCard({ startDate: "2026-05-04", endDate: "2026-05-04" });
    expect(screen.getByText("1 day")).toBeInTheDocument();
  });

  it("shows the real day count for a multi-day course, not hours", () => {
    // 2026-05-04 -> 2026-05-06 used to render "48 hrs".
    renderCard({ startDate: "2026-05-04", endDate: "2026-05-06" });
    expect(screen.getByText("3 days")).toBeInTheDocument();
  });
});
