import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as rtlRender, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));

// GAP-CITIZEN-GRIEVANCES-03: roleGuard reads the session cookie via next/headers,
// which is unavailable under jsdom — mock it with a controllable roles value so
// we can assert both the masked (non-privileged) and full (officer) renders.
const rolesMock = vi.fn(() => [] as string[]);
vi.mock("@/lib/auth/roleGuard", () => ({
  getSessionRoles: () => rolesMock(),
  hasAnyRole: (sessionRoles: string[], allowed: string[]) => sessionRoles.some((r) => allowed.includes(r)),
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
  beforeEach(() => { fetchJsonMock.mockReset(); rolesMock.mockReset(); rolesMock.mockReturnValue([]); });

  it("masks the complainant name for a non-privileged signed-in user (GAP-CITIZEN-GRIEVANCES-03)", async () => {
    rolesMock.mockReturnValue(["citizen"]);
    fetchJsonMock.mockResolvedValue({ data: MOCK_GRIEVANCES, source: "api" });
    await render(GrievancesPage());
    expect(screen.queryByText("Ramesh Kumar")).not.toBeInTheDocument();
    // maskName("Ramesh Kumar") -> "R••••• K•••r"
    expect(screen.getByText("R••••• K•••r")).toBeInTheDocument();
  });

  it("shows the full complainant name for a grievance officer (GAP-CITIZEN-GRIEVANCES-03)", async () => {
    rolesMock.mockReturnValue(["citizen_officer"]);
    fetchJsonMock.mockResolvedValue({ data: MOCK_GRIEVANCES, source: "api" });
    await render(GrievancesPage());
    expect(screen.getByText("Ramesh Kumar")).toBeInTheDocument();
  });

  it("renders grievances and real stat counts on success", async () => {
    fetchJsonMock.mockResolvedValue({ data: MOCK_GRIEVANCES, source: "api" });
    await render(GrievancesPage());
    expect(screen.getByText("CPG-001")).toBeInTheDocument();
  });

  // GAP-CITIZEN-GRIEVANCES-06: the register CTA must not carry a literal "+".
  it("renders the register CTA without a literal '+' prefix", async () => {
    fetchJsonMock.mockResolvedValue({ data: MOCK_GRIEVANCES, source: "api" });
    await render(GrievancesPage());
    const cta = screen.getByText("Register grievance");
    expect(cta).toBeInTheDocument();
    expect(screen.queryByText("+ Register Grievance")).not.toBeInTheDocument();
  });

  // GAP-CITIZEN-GRIEVANCES-02: a grievance the backend sends with no dueDate
  // must show "—" (SLA not set), never a client-fabricated createdAt+30d clock.
  it("shows '—' for a grievance with no backend dueDate (no fabricated statutory clock)", async () => {
    fetchJsonMock.mockResolvedValue({
      data: [
        {
          id: "g2",
          grievanceNo: "CPG-002",
          subject: "Street light",
          complainantName: "Sita Devi",
          category: "electricity",
          status: "pending",
          createdAt: "2026-01-01T00:00:00.000Z",
          // no dueDate / due_date
        },
      ],
      source: "api",
    });
    await render(GrievancesPage());
    expect(screen.getByText("CPG-002")).toBeInTheDocument();
    // The statutory-clock cell renders "—" (DataTable's clock cell for null daysLeft).
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
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
    expect(screen.getByText("We couldn't load grievances.")).toBeInTheDocument();
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
