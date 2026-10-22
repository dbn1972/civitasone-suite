import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import hiMessages from "@/messages/hi.json";
import { formatIndianDate } from "@/lib/formatters";
import type { TrainingProgramSummary } from "@civitasone/types";
import { ProgramCard } from "./ProgramCard";

/**
 * Renders through the real next-intl engine (English), matching the
 * established pattern for "use client" components (see e.g.
 * citizen/grievances/GrievancesTable.test.tsx) rather than mocking
 * next-intl -- this exercises the real trainingNew/training message keys
 * this PR adds to en.json too.
 */
function renderCard(overrides: Partial<TrainingProgramSummary> = {}, locale: "en" | "hi" = "en") {
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
    <NextIntlClientProvider locale={locale} messages={locale === "hi" ? hiMessages : enMessages}>
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

/**
 * GAP-HR-TRAINING-06: one date formatter (lib/formatters), translated card
 * copy and status, and the shared StatusPill for the status badge.
 */
describe("ProgramCard — GAP-HR-TRAINING-06", () => {
  it("dates are exactly what lib/formatters.formatIndianDate returns (no local copy)", () => {
    renderCard({ startDate: "2026-05-04", endDate: "2026-05-06", enrollmentDeadline: "2026-04-30" });
    for (const iso of ["2026-05-04", "2026-05-06", "2026-04-30"]) {
      expect(screen.getByText(formatIndianDate(iso))).toBeInTheDocument();
    }
    expect(formatIndianDate("2026-05-04")).toBe("04 May 2026");
  });

  it("the status badge is the shared StatusPill with the translated label", () => {
    const { container, rerender } = renderCard({ status: "ongoing" });
    const pill = container.querySelector("span.pill");
    expect(pill).not.toBeNull();
    expect(pill).toHaveTextContent("Ongoing");
    expect(pill?.className).toContain("good");
    // The old hand-styled uppercase tailwind span is gone.
    expect(container.querySelector(".uppercase")).toBeNull();

    rerender(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <ProgramCard program={{ id: "p", title: "T", category: null, mode: null, enrollmentDeadline: null, startDate: "2026-05-04", endDate: "2026-05-04", enrolledCount: 0, status: "cancelled" }} />
      </NextIntlClientProvider>,
    );
    expect(container.querySelector("span.pill")?.className).toContain("bad");
  });

  it("Hindi: card text, category/mode badges, status and the Enroll link are translated", () => {
    renderCard({ category: "mandatory", mode: "online", status: "upcoming", enrolledCount: 2, maxCapacity: 10, trainerName: "डॉ. शर्मा" }, "hi");
    expect(screen.getByText("आरंभ तिथि")).toBeInTheDocument();
    expect(screen.getByText("समाप्ति तिथि")).toBeInTheDocument();
    expect(screen.getByText("प्रशिक्षक")).toBeInTheDocument();
    expect(screen.getByText("अनिवार्य")).toBeInTheDocument();
    expect(screen.getByText("ऑनलाइन")).toBeInTheDocument();
    expect(screen.getByText("आगामी")).toBeInTheDocument(); // status pill
    expect(screen.getByText("8 सीटें शेष")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "नामांकन करें" })).toBeInTheDocument();
    for (const english of ["Start date", "End date", "Trainer", "Mandatory", "Upcoming", "Enroll"]) {
      expect(screen.queryByText(english)).not.toBeInTheDocument();
    }
  });
});
