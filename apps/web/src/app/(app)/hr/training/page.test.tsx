import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as rtlRender, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import hiMessages from "@/messages/hi.json";

/**
 * GAP-HR-TRAINING-FEEDBACK-03 (nav label) and GAP-HR-TRAINING-06 (Hindi): the
 * link to the completion-results page must not say "Feedback Reports" -- no
 * feedback is collected, the page lists completion scores -- and the hub is
 * translated.
 */
const state = vi.hoisted(() => ({ locale: "en" as "en" | "hi", roles: ["hr_admin"] as string[] }));

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
const programsMock = vi.fn();
vi.mock("../../../_data/loaders", () => ({ getTrainingPrograms: (...a: unknown[]) => programsMock(...a) }));

import TrainingPage from "./page";

async function renderPage() {
  const ui = await TrainingPage();
  const messages = state.locale === "hi" ? hiMessages : enMessages;
  return rtlRender(<NextIntlClientProvider locale={state.locale} messages={messages}>{ui}</NextIntlClientProvider>);
}

const PROGRAM = {
  id: "p1", title: "Data Protection Basics", category: "mandatory", mode: "online", enrollmentDeadline: null,
  startDate: "2099-05-04", endDate: "2099-05-06", enrolledCount: 2, maxCapacity: 10, status: "upcoming",
};

beforeEach(() => {
  state.locale = "en";
  state.roles = ["hr_admin"];
  programsMock.mockReset().mockResolvedValue({ data: [PROGRAM], source: "api" });
});

describe("TrainingPage hub links — GAP-HR-TRAINING-FEEDBACK-03", () => {
  it("links to /hr/training/feedback as 'Completion Results', not 'Feedback Reports'", async () => {
    await renderPage();
    const link = screen.getByRole("link", { name: "Completion Results" });
    expect(link).toHaveAttribute("href", "/hr/training/feedback");
    expect(screen.queryByText(/feedback reports/i)).not.toBeInTheDocument();
  });

  it("the link is HR-only (an employee is not sent to a page that only shows a permission wall)", async () => {
    state.roles = ["employee"];
    await renderPage();
    expect(screen.queryByRole("link", { name: "Completion Results" })).not.toBeInTheDocument();
  });
});

describe("TrainingPage — GAP-HR-TRAINING-06 Hindi", () => {
  it("title, stats, nav links, card text and status are translated (no English fallback keys)", async () => {
    state.locale = "hi";
    await renderPage();
    expect(screen.getByRole("heading", { name: "प्रशिक्षण कार्यक्रम" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "पूर्णता परिणाम" })).toHaveAttribute("href", "/hr/training/feedback");
    expect(screen.getByRole("link", { name: "नामांकन देखें" })).toHaveAttribute("href", "/hr/training/nominations");
    expect(screen.getAllByText("आगामी").length).toBeGreaterThan(0);
    expect(screen.getAllByText("आरंभ तिथि").length).toBeGreaterThan(0);
    // next-intl prints the key path when a message is missing -- none may leak.
    expect(document.body.textContent).not.toMatch(/\btraining\.[a-zA-Z.]+/);
  });
});
