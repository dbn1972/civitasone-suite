import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import hiMessages from "@/messages/hi.json";
import { formatIndianDate } from "@/lib/formatters";
import type { TrainingProgramSummary } from "@civitasone/types";
import { UpcomingPrograms } from "./UpcomingPrograms";

const PROGRAM: TrainingProgramSummary = {
  id: "prog-7", title: "Leadership Lab", category: "leadership", mode: "blended", enrollmentDeadline: null,
  startDate: "2099-06-10", endDate: "2099-06-11", enrolledCount: 3, maxCapacity: 10, status: "upcoming",
};

function renderStrip(locale: "en" | "hi" = "en") {
  return render(
    <NextIntlClientProvider locale={locale} messages={locale === "hi" ? hiMessages : enMessages}>
      <UpcomingPrograms programs={[PROGRAM]} />
    </NextIntlClientProvider>,
  );
}

/** GAP-HR-TRAINING-06: the upcoming strip shares lib/formatters and is translated. */
describe("UpcomingPrograms — GAP-HR-TRAINING-06", () => {
  it("the start date is exactly what lib/formatters.formatIndianDate returns, and Enroll links to the detail page", () => {
    renderStrip();
    expect(screen.getByText(formatIndianDate("2099-06-10"))).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Enroll" })).toHaveAttribute("href", "/hr/training/prog-7");
    expect(screen.getByText("Upcoming Programs")).toBeInTheDocument();
  });

  it("Hindi: heading, subtitle, badges, seats and the Enroll link are translated", () => {
    renderStrip("hi");
    expect(screen.getByText("आगामी कार्यक्रम")).toBeInTheDocument();
    expect(screen.getByText("अगला 1 निर्धारित प्रशिक्षण")).toBeInTheDocument();
    expect(screen.getByText("मिश्रित")).toBeInTheDocument();
    expect(screen.getByText("नेतृत्व")).toBeInTheDocument();
    expect(screen.getByText("7 सीटें शेष")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "नामांकन करें" })).toBeInTheDocument();
    expect(screen.queryByText("Upcoming Programs")).not.toBeInTheDocument();
  });
});
