import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import hiMessages from "@/messages/hi.json";

// The global next-intl/server mock (vitest.setup.ts) is English-only. This file
// needs both locales, so it replaces it with one that follows `state.locale`.
const state = vi.hoisted(() => ({ locale: "en" as "en" | "hi" }));
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
    getMessages: async () => (state.locale === "hi" ? hi : en),
  };
});

// The Period page and the Home/Runs table both read GET /api/v1/payroll/runs.
const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));

// Home/Runs table: stub the offline-cache hook so the rows are exactly `runs`.
vi.mock("@/lib/sync/resource", () => ({
  useSeededResource: (_key: string, data: unknown) => ({ data, fromCache: false, offline: false, cachedAt: null, provenance: "live" }),
}));

import PayrollPeriodPage from "./page";
import { PayrollRunsTable } from "../PayrollRunsTable";

const STATUSES = ["draft", "processing", "completed", "paid", "failed"] as const;
// One run per status, each in its own pay period so the row can be found by that text.
const RUNS = STATUSES.map((status, i) => ({
  id: `00000000-0000-4000-8000-00000000000${i + 1}`,
  runDate: "2026-09-01",
  payPeriod: `2026-0${i + 1}`,
  employeeCount: 10,
  grossAmount: 100000,
  netAmount: 90000,
  deductions: 10000,
  status,
}));

/** status -> { text, class } of the status pill in the row for that run's pay period. */
function pillsByStatus(container: HTMLElement): Record<string, { text: string; className: string }> {
  const out: Record<string, { text: string; className: string }> = {};
  for (const run of RUNS) {
    const anchor = Array.from(container.querySelectorAll("tbody tr a")).find((a) => a.textContent === run.payPeriod);
    const pill = anchor?.closest("tr")?.querySelector(".pill");
    if (!pill) throw new Error(`no status pill for ${run.status} (${run.payPeriod})`);
    out[run.status] = { text: pill.textContent ?? "", className: pill.className };
  }
  return out;
}

/**
 * GAP-PAYROLL-PERIOD-05: three routes show the same payroll runs -- Home and
 * Runs both render PayrollRunsTable, Period renders its own DataTable. The same
 * status must read and look identical on all of them, in every locale.
 */
describe.each([
  ["en", enMessages],
  ["hi", hiMessages],
] as const)("run status pills are identical on Home/Runs and Period (%s)", (locale, messages) => {
  beforeEach(() => {
    state.locale = locale;
    fetchJsonMock.mockReset();
    fetchJsonMock.mockResolvedValue({ data: RUNS, source: "api" });
  });

  it("shows the same translated text and tone for every status", async () => {
    const period = render(<NextIntlClientProvider locale={locale} messages={messages}>{await PayrollPeriodPage()}</NextIntlClientProvider>);
    const periodPills = pillsByStatus(period.container);
    period.unmount();

    const home = render(
      <NextIntlClientProvider locale={locale} messages={messages}>
        <PayrollRunsTable runs={RUNS as never} />
      </NextIntlClientProvider>,
    );
    const homePills = pillsByStatus(home.container);

    expect(periodPills).toEqual(homePills);
    // ...and that text is the translation, not the raw enum.
    for (const status of STATUSES) {
      expect(periodPills[status]!.text).toBe(messages.payrollRunsTable.status[status]);
    }
  });

  it("paints a completed (awaiting disbursement) run info, never the green of a paid run", async () => {
    const { container } = render(<NextIntlClientProvider locale={locale} messages={messages}>{await PayrollPeriodPage()}</NextIntlClientProvider>);
    const pills = pillsByStatus(container);

    expect(pills.paid!.className).toBe("pill good");
    expect(pills.completed!.className).toBe("pill info");
    expect(pills.failed!.className).toBe("pill bad");
  });
});
