import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as rtlRender, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));

// Pre-existing, unrelated infra gap (confirmed via `git stash` A/B test against
// origin/main, not introduced by UX-017): next-intl publishes "next-intl/server"
// with a `react-server` conditional export; without that condition (which
// Vitest's plain jsdom setup does not set — only Next.js's own RSC bundler
// does), the package resolves to its `server.react-client.js` guard, which
// *throws* "`getTranslations` is not supported in Client Components." for any
// caller. That makes every async Server Component using getTranslations
// un-testable today, for any page/gap, not just this one — flagged separately
// as a follow-up (fix belongs in vitest.config.ts / tooling, not in a
// citizen-hub translation PR, since a naive global fix risks breaking the
// NextIntlClientProvider-based client-component tests elsewhere, e.g.
// AccountMenu.test.tsx / LanguageSwitcher.test.tsx).
//
// Workaround scoped to this file only: a minimal getTranslations mock backed
// by the real en.json, doing plain dot-path lookup + `{param}` substitution
// (this page never uses ICU plurals/rich text, so that's the full contract it
// needs). This keeps the test honestly checking *this component's* namespace
// and key wiring; the real next-intl ICU engine (plurals, t.rich) is exercised
// separately in GrievancesTable.test.tsx via NextIntlClientProvider, which
// vitest resolves correctly since useTranslations only needs next-intl's
// client entry.
vi.mock("next-intl/server", async () => {
  const messages = (await import("@/messages/en.json")).default as Record<string, unknown>;
  function resolve(obj: unknown, dotted: string): unknown {
    return dotted.split(".").reduce<unknown>((acc, k) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[k] : undefined), obj);
  }
  function makeT(namespace?: string) {
    const scope = namespace ? resolve(messages, namespace) : messages;
    return (key: string, values?: Record<string, unknown>) => {
      const found = resolve(scope, key);
      let str = typeof found === "string" ? found : key;
      if (values) for (const [k, v] of Object.entries(values)) str = str.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
      return str;
    };
  }
  return {
    getTranslations: async (namespace?: string) => makeT(namespace),
    getLocale: async () => "en",
    getMessages: async () => messages,
  };
});

import GrievancesPage from "./page";

// UX-017: GrievancesTable (rendered on the success path) now reads next-intl's
// useTranslations() for its column labels and statutory-clock cell — every
// render here needs the same NextIntlClientProvider the real root layout supplies.
async function render(page: Promise<React.ReactElement>) {
  const ui = await page;
  return rtlRender(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);
}

const MOCK_GRIEVANCES = [
  {
    id: "g1",
    grievanceNo: "CPG-001",
    subject: "Water supply",
    complainantName: "Ramesh Kumar",
    category: "water_supply",
    status: "pending",
    dueDate: "2026-09-30",
  },
];

describe("GrievancesPage", () => {
  beforeEach(() => fetchJsonMock.mockReset());

  it("renders grievances and real stat counts on success", async () => {
    fetchJsonMock.mockResolvedValue({ data: MOCK_GRIEVANCES, source: "api" });
    await render(GrievancesPage());
    expect(screen.getByText("CPG-001")).toBeInTheDocument();
  });

  it("shows the honest empty state when a tenant genuinely has zero grievances (source: api, [])", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });
    await render(GrievancesPage());
    expect(screen.getByText("No grievances filed")).toBeInTheDocument();
    expect(screen.getAllByText("0").length).toBeGreaterThan(0);
  });

  it("shows the error state — not the empty-state prompt — on a real fetch failure (source: error)", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "error" });
    await render(GrievancesPage());
    expect(screen.getByText("We couldn't load this grievances.")).toBeInTheDocument();
    expect(screen.queryByText("No grievances filed")).not.toBeInTheDocument();
    // Stat cards show "—", not a fabricated 0.
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  it("shows the translated grievance-register table title on the error path (regression: was double-namespaced 'grievances.tableTitle')", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "error" });
    await render(GrievancesPage());
    expect(screen.getByText("Grievance Register")).toBeInTheDocument();
  });
});
