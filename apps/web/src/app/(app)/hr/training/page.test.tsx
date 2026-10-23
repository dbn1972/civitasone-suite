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
 *
 * GAP-HR-TRAINING-NEW-01: the `?created=<id>` hand-off from the new-programme
 * form shows a pending notice while the 202'd programme is not in the list yet.
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
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import TrainingPage from "./page";

async function renderPage(searchParams?: { created?: string | string[] }) {
  const ui = await TrainingPage({ searchParams: Promise.resolve(searchParams ?? {}) });
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

const NEW_ID = "11111111-2222-4333-8444-555555555555";
const program = (id: string) => ({
  id,
  title: `Programme ${id.slice(0, 4)}`,
  category: null,
  mode: null,
  enrollmentDeadline: null,
  trainerName: undefined,
  startDate: "2099-01-01",
  endDate: "2099-01-02",
  venue: undefined,
  enrolledCount: 0,
  maxCapacity: 30,
  status: "upcoming",
});

describe("TrainingPage ?created= hand-off (GAP-HR-TRAINING-NEW-01)", () => {
  it("shows a pending notice while the just-submitted programme is not in the list yet", async () => {
    programsMock.mockResolvedValue({ data: [program("aaaaaaaa-0000-4000-8000-000000000001")], source: "api" });
    await renderPage({ created: NEW_ID });
    expect(screen.getByText(/still being processed/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /refresh now/i })).toBeInTheDocument();
  });

  it("shows the pending notice even when the list is still empty", async () => {
    programsMock.mockResolvedValue({ data: [], source: "api" });
    await renderPage({ created: NEW_ID });
    expect(screen.getByText(/still being processed/i)).toBeInTheDocument();
  });

  it("shows no notice once the programme is in the list", async () => {
    programsMock.mockResolvedValue({ data: [program(NEW_ID)], source: "api" });
    await renderPage({ created: NEW_ID });
    expect(screen.queryByText(/still being processed/i)).not.toBeInTheDocument();
  });

  it("ignores a created value that is not a UUID", async () => {
    programsMock.mockResolvedValue({ data: [], source: "api" });
    await renderPage({ created: "<script>alert(1)</script>" });
    expect(screen.queryByText(/still being processed/i)).not.toBeInTheDocument();
  });

  it("shows no notice without the param", async () => {
    programsMock.mockResolvedValue({ data: [], source: "api" });
    await renderPage();
    expect(screen.queryByText(/still being processed/i)).not.toBeInTheDocument();
  });

  it("does not claim a pending programme when the list itself errored", async () => {
    programsMock.mockResolvedValue({ data: [], source: "error" });
    await renderPage({ created: NEW_ID });
    expect(screen.queryByText(/still being processed/i)).not.toBeInTheDocument();
  });
});
