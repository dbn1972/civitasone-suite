import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as rtlRender, screen, within, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import hiMessages from "@/messages/hi.json";
import { formatIndianDate } from "@/lib/formatters";

/**
 * GAP-HR-TRAINING-FEEDBACK-03/04/05: the training completion-results page.
 * It is a projection of completed nominations (a 0-100 completion score), not
 * collected feedback -- so the copy says so; submittedOn uses the shared date
 * formatter; a failed load shows the unknown dash (never a fabricated 0); a
 * truncated list says how many exist; the Score header carries its scale; and
 * the page is translated.
 */
const state = vi.hoisted(() => ({ locale: "en" as "en" | "hi", roles: ["hr_admin"] as string[], payload: null as unknown, fail: false }));

vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  const en = (await import("@/messages/en.json")).default;
  const hi = (await import("@/messages/hi.json")).default;
  return {
    getTranslations: async (arg?: string | { namespace?: string }) => {
      const namespace = typeof arg === "string" ? arg : arg?.namespace;
      return createTranslator({ locale: state.locale, messages: state.locale === "hi" ? hi : en, namespace } as Parameters<typeof createTranslator>[0]);
    },
    getLocale: async () => state.locale,
  };
});
vi.mock("@/lib/auth/roleGuard", () => ({ getSessionRoles: () => state.roles }));
// Run the page's REAL mapResponse over a canned payload so the date/score/total mapping is exercised.
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: async (_url: string, fallback: unknown, opts: { mapResponse: (p: unknown) => unknown }) =>
    state.fail ? { data: fallback, source: "error" } : { data: opts.mapResponse(state.payload) ?? fallback, source: "api" },
}));

import TrainingFeedbackPage from "./page";

async function renderPage() {
  const ui = await TrainingFeedbackPage();
  const messages = state.locale === "hi" ? hiMessages : enMessages;
  return rtlRender(<NextIntlClientProvider locale={state.locale} messages={messages}>{ui}</NextIntlClientProvider>);
}
const statValues = (container: HTMLElement) => [...container.querySelectorAll(".stat .val")].map((el) => el.textContent);

const ROWS = [
  { id: "n1", employee: "Asha Rao", program: "Data Protection", score: 82, submittedOn: "2026-03-05" },
  { id: "n2", employee: "Kiran Bose", program: "Leadership Lab", score: null, submittedOn: "2026-03-07" },
];

beforeEach(() => {
  state.locale = "en";
  state.roles = ["hr_admin"];
  state.fail = false;
  state.payload = { data: ROWS, total: 2, truncated: false };
});

describe("TrainingFeedbackPage — GAP-HR-TRAINING-FEEDBACK-04", () => {
  it("shows submittedOn through lib/formatters.formatIndianDate, never the raw ISO string", async () => {
    await renderPage();
    expect(screen.getByText(formatIndianDate("2026-03-05"))).toBeInTheDocument();
    expect(formatIndianDate("2026-03-05")).toBe("05 Mar 2026");
    expect(screen.queryByText("2026-03-05")).not.toBeInTheDocument();
  });

  it("the date column (Completed On) sorts chronologically (raw ISO kept for sorting), not by the formatted day-of-month text", async () => {
    // As display strings these would sort "02 Apr 2026" < "15 Dec 2025" < "28 Mar 2026" (day first),
    // which is NOT chronological. Sorting on the raw ISO date must give Dec 2025 < Mar 2026 < Apr 2026.
    state.payload = {
      data: [
        { id: "a", employee: "Asha Rao", program: "Data Protection", score: 82, submittedOn: "2026-04-02" },
        { id: "b", employee: "Kiran Bose", program: "Leadership Lab", score: 70, submittedOn: "2026-03-28" },
        { id: "c", employee: "Meera Iyer", program: "Ethics", score: 65, submittedOn: "2025-12-15" },
      ],
      total: 3,
      truncated: false,
    };
    await renderPage();
    const order = () => screen.getAllByRole("row").slice(1).map((r) => within(r).getAllByRole("cell")[0].textContent);
    const header = screen.getByRole("columnheader", { name: /Completed On/ });

    fireEvent.click(header);
    expect(header).toHaveAttribute("aria-sort", "ascending");
    expect(order()).toEqual(["Meera Iyer", "Kiran Bose", "Asha Rao"]);

    fireEvent.click(header);
    expect(header).toHaveAttribute("aria-sort", "descending");
    expect(order()).toEqual(["Asha Rao", "Kiran Bose", "Meera Iyer"]);

    // The cells still show the shared Indian date format, never the raw ISO.
    expect(screen.getByText("02 Apr 2026")).toBeInTheDocument();
    expect(screen.queryByText("2026-04-02")).not.toBeInTheDocument();
  });

  it("a failed load shows the unknown dash in all four stat cards -- not 0", async () => {
    state.fail = true;
    const { container } = await renderPage();
    expect(statValues(container)).toEqual(["—", "—", "—", "—"]);
  });

  it("a successful load shows the real figures (employees/programmes counted, average of the scored rows only)", async () => {
    const { container } = await renderPage();
    expect(statValues(container)).toEqual(["2", "2", "2", "82.0/100"]);
  });

  it("truncated=true shows the cap notice with the REAL total from the server", async () => {
    state.payload = { data: ROWS, total: 501, truncated: true };
    await renderPage();
    expect(screen.getByText("Showing latest 2 of 501 results.")).toBeInTheDocument();
  });

  it("not truncated: no cap notice", async () => {
    await renderPage();
    expect(screen.queryByText(/Showing latest/)).not.toBeInTheDocument();
  });

  it("an unscored completion shows a dash, not a fabricated 0/100", async () => {
    await renderPage();
    const row = screen.getByText("Kiran Bose").closest("tr") as HTMLElement;
    expect(within(row).getByText("—")).toBeInTheDocument();
    expect(within(row).queryByText(/0\/100/)).not.toBeInTheDocument();
  });
});

describe("TrainingFeedbackPage — GAP-HR-TRAINING-FEEDBACK-03/05 copy", () => {
  it("the Score column header carries its scale, and no copy claims feedback is collected", async () => {
    await renderPage();
    expect(screen.getByRole("columnheader", { name: /Score \(out of 100\)/ })).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { name: "Training Completion Results" }).length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toMatch(/feedback is collected|collected at programme closure/i);
  });

  it("empty list explains where results come from without claiming feedback is collected", async () => {
    state.payload = { data: [], total: 0, truncated: false };
    await renderPage();
    expect(screen.getByText("No completion results yet")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/feedback is collected/i);
  });

  it("Hindi: title, back link, filter placeholder, score header and the truncation notice are translated", async () => {
    state.locale = "hi";
    state.payload = { data: ROWS, total: 501, truncated: true };
    await renderPage();
    expect(screen.getAllByRole("heading", { name: "प्रशिक्षण पूर्णता परिणाम" }).length).toBeGreaterThan(0);
    expect(screen.getByText("मानव संसाधन पर वापस जाएं")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("कर्मचारी या कार्यक्रम के अनुसार फ़िल्टर करें…")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /अंक \(100 में से\)/ })).toBeInTheDocument();
    expect(screen.getByText("501 में से नवीनतम 2 परिणाम दिखाए जा रहे हैं।")).toBeInTheDocument();
    expect(screen.queryByText("Back to HR")).not.toBeInTheDocument();
    expect(screen.queryByText(/Filter by employee/)).not.toBeInTheDocument();
  });

  it("non-HR roles still get the permission wall, not the results", async () => {
    state.roles = ["employee"];
    await renderPage();
    expect(screen.queryByText("Training Completion Results")).not.toBeInTheDocument();
    expect(screen.queryByText("Asha Rao")).not.toBeInTheDocument();
  });
});
