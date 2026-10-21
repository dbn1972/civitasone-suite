import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import hiMessages from "@/messages/hi.json";

/**
 * GAP-HR-ATTENDANCE-CONFIG-03: an hr_admin (the audience this page is gated
 * to) used to be told to "contact your administrator to customize" values
 * that nothing can customize. en.json was reworded, but hi.json kept the old
 * instruction, so a Hindi-locale hr_admin still saw it. These tests render
 * the real page in both locales.
 */
const state = vi.hoisted(() => ({ locale: "en" as "en" | "hi", roles: ["hr_admin"] as string[] }));

vi.mock("@/lib/auth/roleGuard", () => ({ getSessionRoles: () => state.roles }));

// The shared setup mock is English-only; this suite needs to flip locale.
vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  const en = (await import("@/messages/en.json")).default;
  const hi = (await import("@/messages/hi.json")).default;
  return {
    getTranslations: async (arg?: string | { namespace?: string }) => {
      const namespace = typeof arg === "string" ? arg : arg?.namespace;
      const messages = state.locale === "hi" ? hi : en;
      return createTranslator({ locale: state.locale, messages, namespace } as Parameters<typeof createTranslator>[0]);
    },
    getLocale: async () => state.locale,
    getMessages: async () => (state.locale === "hi" ? hi : en),
  };
});

import AttendanceConfigPage from "./page";

async function renderPage(locale: "en" | "hi") {
  state.locale = locale;
  const ui = await AttendanceConfigPage();
  return render(
    <NextIntlClientProvider locale={locale} messages={locale === "hi" ? hiMessages : enMessages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("AttendanceConfigPage defaults notice (GAP-HR-ATTENDANCE-CONFIG-03)", () => {
  beforeEach(() => {
    state.roles = ["hr_admin"];
    state.locale = "en";
  });

  it("an hr_admin never sees 'contact your administrator' (en)", async () => {
    await renderPage("en");
    const note = screen.getByRole("note");
    expect(note).toHaveTextContent(/cannot|nothing to customize/i);
    expect(note).toHaveTextContent(/change request/i);
    expect(screen.queryByText(/contact your administrator/i)).toBeNull();
  });

  it("an hr_admin never sees the Hindi 'contact your administrator' instruction (hi)", async () => {
    await renderPage("hi");
    const note = screen.getByRole("note");
    expect(note.textContent).toBe(hiMessages.attendanceConfig.defaultsNotice);
    // old wording: "अनुकूलित करने के लिए अपने प्रशासक से संपर्क करें"
    expect(note.textContent).not.toContain("प्रशासक से संपर्क");
    expect(note.textContent).toContain("परिवर्तन अनुरोध");
  });

  it("policy values come from code, not from a translatable literal (hi renders the same 12-hour times and minutes)", async () => {
    await renderPage("hi");
    // 09:30 / 18:00 are ATTENDANCE_DEFAULTS, formatted by the page; the hi
    // strings are templates, so changing a default changes the page in hi too.
    expect(screen.getByText("09:30 AM")).toBeInTheDocument();
    expect(screen.getByText("06:00 PM")).toBeInTheDocument();
    expect(screen.getAllByText("15 मिनट").length).toBeGreaterThan(0);
    expect(screen.getByText("8.5 घंटे कार्य के बाद")).toBeInTheDocument();
  });

  it("a non-admin role is denied and sees no notice", async () => {
    state.roles = ["employee"];
    await renderPage("en");
    expect(screen.queryByRole("note")).toBeNull();
  });
});

describe("attendanceConfig locale parity (en <-> hi)", () => {
  it("hi carries exactly the keys en carries (no stale loadingTitle/loadingSubtitle, none missing)", () => {
    const en = Object.keys(enMessages.attendanceConfig).sort();
    const hi = Object.keys(hiMessages.attendanceConfig).sort();
    expect(hi).toEqual(en);
  });

  it("every value template in hi keeps the same ICU placeholders as en", () => {
    const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    const en = enMessages.attendanceConfig as Record<string, string>;
    const hi = hiMessages.attendanceConfig as Record<string, string>;
    for (const key of Object.keys(en)) {
      // Text-valued policy fields (weekly off / approval wording / CO earned-when)
      // are passed as {value} by en but translated prose in hi by design.
      if (["whWeeklyOffVal", "otRequiresApprovalVal", "coEarnedWhenVal", "coApprovalRequiredVal"].includes(key)) continue;
      expect(placeholders(hi[key]!), `placeholders for ${key}`).toEqual(placeholders(en[key]!));
    }
  });
});
