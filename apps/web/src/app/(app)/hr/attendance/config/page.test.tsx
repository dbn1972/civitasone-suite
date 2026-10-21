import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { createTranslator } from "next-intl";
import en from "@/messages/en.json";
import hi from "@/messages/hi.json";
import ta from "@/messages/ta.json";
import te from "@/messages/te.json";
import kn from "@/messages/kn.json";
import { ATTENDANCE_DEFAULTS } from "@/lib/attendanceDefaults";

const LOCALES = { en, hi, ta, te, kn } as const;
type Loc = keyof typeof LOCALES;

const state = vi.hoisted(() => ({ locale: "en" as string, errors: [] as unknown[] }));
const { getSessionRolesMock } = vi.hoisted(() => ({ getSessionRolesMock: vi.fn((): string[] => ["hr_admin"]) }));
vi.mock("@/lib/auth/roleGuard", () => ({ getSessionRoles: getSessionRolesMock }));

// The shared next-intl/server mock is English-only; this suite renders the
// page in every locale, so it supplies the locale-aware translator itself.
vi.mock("next-intl/server", async () => {
  const { createTranslator: create } = await import("next-intl");
  const all = {
    en: (await import("@/messages/en.json")).default,
    hi: (await import("@/messages/hi.json")).default,
    ta: (await import("@/messages/ta.json")).default,
    te: (await import("@/messages/te.json")).default,
    kn: (await import("@/messages/kn.json")).default,
  } as Record<string, Record<string, unknown>>;
  return {
    getTranslations: async (arg?: string | { namespace?: string }) => {
      const namespace = typeof arg === "string" ? arg : arg?.namespace;
      return create({
        locale: state.locale,
        messages: all[state.locale],
        namespace,
        onError: (e: unknown) => { state.errors.push(e); },
      } as Parameters<typeof create>[0]);
    },
    getLocale: async () => state.locale,
    getMessages: async () => all[state.locale],
  };
});

import AttendanceConfigPage from "./page";

async function rows(locale: Loc): Promise<Array<[string, string]>> {
  state.locale = locale;
  state.errors = [];
  const { container, unmount } = render(await AttendanceConfigPage());
  const out = Array.from(container.querySelectorAll("tbody tr")).map((tr) => [
    tr.querySelector("th")!.textContent ?? "",
    tr.querySelector("td")!.textContent ?? "",
  ] as [string, string]);
  unmount();
  return out;
}

const EN_ROWS: Array<[string, string]> = [
  ["Office start time", "09:30 AM"],
  ["Office end time", "06:00 PM"],
  ["Grace period (late mark)", "15 minutes"],
  ["Half-day cutoff", "After 12:30 PM arrival"],
  ["Minimum hours for full day", "7.5 hours"],
  ["Weekly off", "Saturday & Sunday"],
  ["Grace period", "15 min after start time"],
  ["Late mark trigger", "Check-in after 09:45 AM"],
  ["Half-day if", "Check-in after 12:30 PM"],
  ["Absent if", "No check-in by 02:00 PM"],
  ["Late marks → CL deduction", "3 late marks = 1 CL deducted"],
  ["OT eligible after", "8.5 hours worked"],
  ["OT rate (weekday)", "1.5× hourly rate"],
  ["OT rate (weekly off / holiday)", "2× hourly rate"],
  ["Max OT per day", "4 hours"],
  ["Requires approval", "Yes (supervisor)"],
  ["Earned when", "Worked on a holiday / weekly off"],
  ["Must be availed within", "30 days of earning"],
  ["Max accumulation", "3 COs at a time"],
  ["Approval required", "Yes (supervisor)"],
];

// The Hindi page used to carry these numbers as literal text in hi.json; they
// must read the same now that the numbers come from attendanceDefaults.ts.
const HI_ROWS: Array<[string, string]> = [
  ["कार्यालय प्रारंभ समय", "09:30 AM"],
  ["कार्यालय समाप्ति समय", "06:00 PM"],
  ["छूट अवधि (विलंब चिह्न)", "15 मिनट"],
  ["आधा दिन कटऑफ", "12:30 PM के बाद आगमन पर"],
  ["पूर्ण दिन हेतु न्यूनतम घंटे", "7.5 घंटे"],
  ["साप्ताहिक अवकाश", "शनिवार और रविवार"],
  ["छूट अवधि", "प्रारंभ समय के 15 मिनट बाद तक"],
  ["विलंब चिह्न ट्रिगर", "09:45 AM के बाद चेक-इन"],
  ["आधा दिन यदि", "12:30 PM के बाद चेक-इन"],
  ["अनुपस्थित यदि", "02:00 PM तक कोई चेक-इन नहीं"],
  ["विलंब चिह्न → CL कटौती", "3 विलंब चिह्न = 1 CL कटौती"],
  ["OT पात्रता", "8.5 घंटे कार्य के बाद"],
  ["OT दर (सप्ताह के दिन)", "1.5× प्रति घंटा दर"],
  ["OT दर (साप्ताहिक अवकाश / अवकाश)", "2× प्रति घंटा दर"],
  ["प्रतिदिन अधिकतम OT", "4 घंटे"],
  ["अनुमोदन आवश्यक", "हाँ (पर्यवेक्षक)"],
  ["कब अर्जित होता है", "अवकाश / साप्ताहिक अवकाश पर कार्य करने पर"],
  ["इतने समय के भीतर उपयोग आवश्यक", "अर्जित होने के 30 दिनों के भीतर"],
  ["अधिकतम संचयन", "एक समय में अधिकतम 3 CO"],
  ["अनुमोदन आवश्यक", "हाँ (पर्यवेक्षक)"],
];

beforeEach(() => {
  getSessionRolesMock.mockReturnValue(["hr_admin"]);
  state.locale = "en";
});

describe("/hr/attendance/config rows (GAP-HR-ATTENDANCE-CONFIG-02)", () => {
  it("renders the current policy defaults in English, row for row", async () => {
    expect(await rows("en")).toEqual(EN_ROWS);
    expect(state.errors).toEqual([]);
  });

  it("renders the same numbers in Hindi, row for row", async () => {
    expect(await rows("hi")).toEqual(HI_ROWS);
    expect(state.errors).toEqual([]);
  });

  it.each(["ta", "te", "kn"] as const)("%s has the whole namespace: no missing or malformed message", async (loc) => {
    const r = await rows(loc);
    expect(r).toHaveLength(EN_ROWS.length);
    expect(state.errors).toEqual([]);
    for (const [label, value] of r) {
      expect(label.trim()).not.toBe("");
      expect(value.trim()).not.toBe("");
      expect(label).not.toMatch(/^attendanceConfig\./); // not a raw key fallback
      expect(value).not.toMatch(/^attendanceConfig\./);
    }
  });

  it("changing a value in attendanceDefaults.ts changes the page in every locale", async () => {
    const saved = { ...ATTENDANCE_DEFAULTS };
    try {
      Object.assign(ATTENDANCE_DEFAULTS, {
        officeStartTime: "10:15",
        graceMinutes: 20,
        minHoursForFullDay: 8,
        lateMarksPerClDeducted: 4,
        otEligibleAfterHours: 9,
        otRateWeekdayMultiplier: 1.75,
        coMustAvailWithinDays: 45,
        coMaxAccumulation: 5,
      });
      for (const loc of Object.keys(LOCALES) as Loc[]) {
        const r = await rows(loc);
        const text = r.map(([, v]) => v).join(" | ");
        expect(text, `${loc} start time`).toContain("10:15 AM");
        expect(text, `${loc} min hours`).toMatch(/(^|\D)8(\D|$)/);
        expect(text, `${loc} late marks`).toContain("4");
        expect(text, `${loc} OT after`).toContain("9");
        expect(text, `${loc} OT rate`).toContain("1.75");
        expect(text, `${loc} accumulation`).toContain("5");
        // The rows whose number changed show the new one and not the old one
        // (rows are in page order: [2] grace period, [17] comp-off availing window).
        expect(r[2]![1], `${loc} grace`).toContain("20");
        expect(r[2]![1], `${loc} stale grace`).not.toContain("15");
        expect(r[17]![1], `${loc} avail`).toContain("45");
        expect(r[17]![1], `${loc} stale avail`).not.toContain("30");
        expect(state.errors, loc).toEqual([]);
      }
    } finally {
      Object.assign(ATTENDANCE_DEFAULTS, saved);
    }
  });
});

describe("/hr/attendance/config notice (GAP-HR-ATTENDANCE-CONFIG-01, option b)", () => {
  it.each(Object.keys(LOCALES) as Loc[])("%s: shows the not-verified / may-not-match banner as role=note", async (loc) => {
    state.locale = loc;
    render(await AttendanceConfigPage());
    const note = screen.getByRole("note");
    expect(note).toHaveTextContent((LOCALES[loc].attendanceConfig as { defaultsNotice: string }).defaultsNotice);
    expect(note.textContent!.length).toBeGreaterThan(80);
  });

  it("English banner says the values are not read from the tenant, not verified against the engine, and may not match policy", async () => {
    state.locale = "en";
    render(await AttendanceConfigPage());
    const text = screen.getByRole("note").textContent!;
    expect(text).toMatch(/not settings read from this tenant/i);
    expect(text).toMatch(/not been verified against the engine/i);
    expect(text).toMatch(/may not match your tenant's actual policy/i);
  });

  it("Hindi banner is the reworded one, not the old 'contact your administrator' text", async () => {
    state.locale = "hi";
    render(await AttendanceConfigPage());
    const text = screen.getByRole("note").textContent!;
    expect(text).not.toContain("अपने प्रशासक से संपर्क करें");
    expect(text).toContain("सत्यापित");
    expect(text).toContain("वास्तविक नीति");
  });

  it("is restricted to the admin tier", async () => {
    getSessionRolesMock.mockReturnValue(["employee"]);
    render(await AttendanceConfigPage());
    expect(screen.getByText("Access restricted")).toBeInTheDocument();
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });
});

// Key-level guarantees over the locale files themselves (acceptance 2).
describe("attendanceConfig locale catalogue (GAP-HR-ATTENDANCE-CONFIG-02)", () => {
  const enNs = en.attendanceConfig as Record<string, string>;
  const nsOf = (loc: Loc) => (LOCALES[loc] as unknown as Record<string, Record<string, string>>).attendanceConfig!;
  const SENTINELS = { value: "§V§", mins: "§M§", hours: "§H§", marks: "§K§", multiplier: "§X§", days: "§D§", count: "§C§", pattern: "sat_sun", approver: "supervisor", rule: "holiday_or_weekly_off" };
  const tplKeys = Object.keys(enNs).filter((k) => k.endsWith("Tpl"));
  const render1 = (loc: Loc, key: string) => {
    const errors: unknown[] = [];
    const t = createTranslator({ locale: loc, messages: LOCALES[loc], namespace: "attendanceConfig", onError: (e: unknown) => { errors.push(e); } } as Parameters<typeof createTranslator>[0]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = (t as any)(key, SENTINELS) as string;
    return { out, errors };
  };
  const sentinelsIn = (s: string) => (s.match(/§\w§/g) ?? []).sort();

  it("no *Val key remains in any locale (they are templates, named *Tpl)", () => {
    for (const loc of Object.keys(LOCALES) as Loc[]) {
      const ns = nsOf(loc);
      expect(Object.keys(ns).filter((k) => k.endsWith("Val")), loc).toEqual([]);
    }
  });

  it("every locale carries exactly en's keys for the namespace (key parity)", () => {
    for (const loc of ["hi", "ta", "te", "kn"] as const) {
      const ns = nsOf(loc);
      expect(Object.keys(ns).sort(), loc).toEqual(Object.keys(enNs).sort());
    }
  });

  it.each(["hi", "ta", "te", "kn"] as const)("%s: every template takes the same parameters as en and carries no number of its own", (loc) => {
    for (const key of tplKeys) {
      const mine = render1(loc, key);
      const theirs = render1("en", key);
      expect(mine.errors, `${loc}.${key}`).toEqual([]);
      expect(sentinelsIn(mine.out), `${loc}.${key} params`).toEqual(sentinelsIn(theirs.out));
      // Any digit in the output must be one the English template also has (e.g. the "1" in "= 1 CL"), never a policy value.
      const strip = (s: string) => s.replace(/§\w§/g, "");
      expect((strip(mine.out).match(/\d+(\.\d+)?/g) ?? []), `${loc}.${key} literal numbers`).toEqual(strip(theirs.out).match(/\d+(\.\d+)?/g) ?? []);
    }
  });

  it("a translator cannot change which row a code selects: unknown codes render a dash, not a made-up value", () => {
    for (const loc of Object.keys(LOCALES) as Loc[]) {
      const t = createTranslator({ locale: loc, messages: LOCALES[loc], namespace: "attendanceConfig" } as Parameters<typeof createTranslator>[0]);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((t as any)("whWeeklyOffTpl", { pattern: "mon_only" })).toBe("—");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((t as any)("coEarnedWhenTpl", { rule: "anything" })).toBe("—");
    }
  });
});
