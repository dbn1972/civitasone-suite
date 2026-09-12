import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import hiMessages from "@/messages/hi.json";
import { GrievancesTable, type GrievanceRow } from "./GrievancesTable";

// UX-017: GrievancesTable's statutory-clock cell was restructured off a plain
// (non-component) helper function into one that takes pre-resolved label
// strings, because a hook (useTranslations) cannot be called from a function
// that isn't a component or another hook. This test exercises the real
// next-intl ICU engine (via NextIntlClientProvider, which vitest resolves
// correctly for the client entry) to prove both the column labels AND the
// pluralised day-count states resolve — in English and Hindi.
function renderTable(rows: GrievanceRow[], locale: "en" | "hi" = "en") {
  const messages = locale === "hi" ? hiMessages : enMessages;
  return render(
    <NextIntlClientProvider locale={locale} messages={messages}>
      <GrievancesTable rows={rows} />
    </NextIntlClientProvider>,
  );
}

const BASE_ROW: GrievanceRow = {
  id: "g1",
  grievanceNo: "CPG-001",
  subject: "Water supply",
  complainantName: "Ramesh Kumar",
  category: "water_supply",
  status: "pending",
  daysLeft: 5,
};

describe("GrievancesTable", () => {
  it("renders translated column headers", () => {
    renderTable([BASE_ROW]);
    expect(screen.getByText("Grievance No")).toBeInTheDocument();
    expect(screen.getByText("Complainant")).toBeInTheDocument();
    expect(screen.getByText("Days Left")).toBeInTheDocument();
  });

  it("shows the singular day-count form", () => {
    renderTable([{ ...BASE_ROW, daysLeft: 1 }]);
    expect(screen.getByText("1 day left")).toBeInTheDocument();
  });

  it("shows the plural day-count form", () => {
    renderTable([{ ...BASE_ROW, daysLeft: 5 }]);
    expect(screen.getByText("5 days left")).toBeInTheDocument();
  });

  it("shows the overdue form with pluralised count", () => {
    renderTable([{ ...BASE_ROW, daysLeft: -3 }]);
    expect(screen.getByText("Overdue by 3 days")).toBeInTheDocument();
  });

  it("shows the singular overdue form", () => {
    renderTable([{ ...BASE_ROW, daysLeft: -1 }]);
    expect(screen.getByText("Overdue by 1 day")).toBeInTheDocument();
  });

  it("shows 'Due today' when zero days remain", () => {
    renderTable([{ ...BASE_ROW, daysLeft: 0 }]);
    expect(screen.getByText("Due today")).toBeInTheDocument();
  });

  it("shows 'Closed' for a resolved grievance regardless of days left", () => {
    renderTable([{ ...BASE_ROW, status: "resolved", daysLeft: -10 }]);
    expect(screen.getByText("Closed")).toBeInTheDocument();
  });

  it("renders the Hindi locale's translated headers and pluralised clock text", () => {
    renderTable([{ ...BASE_ROW, daysLeft: 2 }], "hi");
    expect(screen.getByText("शिकायत सं.")).toBeInTheDocument();
    expect(screen.getByText("2 दिन शेष")).toBeInTheDocument();
  });
});
