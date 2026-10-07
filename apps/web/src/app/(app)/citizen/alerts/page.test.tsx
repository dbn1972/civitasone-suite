import { describe, it, expect, vi } from "vitest";
import { render as rtlRender, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const getCitizenAlertsMock = vi.fn();
vi.mock("../../../_data/loaders", () => ({
  getCitizenAlerts: (...args: unknown[]) => getCitizenAlertsMock(...args),
}));

// See grievances/page.test.tsx for the full explanation: next-intl/server
// resolves to a throwing guard under plain Vitest (no `react-server`
// condition), a pre-existing, unrelated gap. Minimal same-shape mock here too.
vi.mock("next-intl/server", async () => {
  const messages = (await import("@/messages/en.json")).default as Record<string, unknown>;
  function resolve(obj: unknown, dotted: string): unknown {
    return dotted.split(".").reduce<unknown>((acc, k) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[k] : undefined), obj);
  }
  return {
    getTranslations: async (namespace?: string) => {
      const scope = namespace ? resolve(messages, namespace) : messages;
      return (key: string) => {
        const found = resolve(scope, key);
        return typeof found === "string" ? found : key;
      };
    },
    getLocale: async () => "en",
    getMessages: async () => messages,
  };
});

import AlertsPage from "./page";

function render(page: Promise<React.ReactElement>) {
  return page.then((ui) => rtlRender(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>));
}

const MOCK_ALERTS = [
  { id: "a1", title: "Water outage notice", category: "Utilities", publishedDate: "2026-09-01", targetAudience: "All wards", status: "Active" },
];

describe("AlertsPage", () => {
  it("renders the translated page header, stat labels, and table column headers", async () => {
    getCitizenAlertsMock.mockResolvedValue({ data: MOCK_ALERTS, source: "api" });
    await render(AlertsPage());

    expect(screen.getByText("Public Alerts & Notifications")).toBeInTheDocument();
    expect(screen.getByText("Broadcast alerts and targeted notifications for citizens.")).toBeInTheDocument();
    expect(screen.getByText("Active Alerts")).toBeInTheDocument();
    expect(screen.getByText("Total Published")).toBeInTheDocument();
    expect(screen.getByText("Target Audience")).toBeInTheDocument();
    expect(screen.getByText("Water outage notice")).toBeInTheDocument();
  });

  it("shows the translated empty state when there are no alerts", async () => {
    getCitizenAlertsMock.mockResolvedValue({ data: [], source: "api" });
    await render(AlertsPage());

    expect(screen.getByText("No alerts published")).toBeInTheDocument();
    expect(screen.getByText("Public alerts and notifications will appear here once published.")).toBeInTheDocument();
  });

  it("GAP-CITIZEN-ALERTS-01: on a failed fetch, stat cards show '—' (not fabricated 0s) and the error state replaces the table", async () => {
    getCitizenAlertsMock.mockResolvedValue({ data: [], source: "error" });
    await render(AlertsPage());

    // Four stat cards all read "—" rather than 0.
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(4);
    // The misleading "No alerts published" prompt must NOT appear on an outage.
    expect(screen.queryByText("No alerts published")).not.toBeInTheDocument();
    // A real retry-able error state is shown instead.
    expect(screen.getByText("We couldn't load alerts.")).toBeInTheDocument();
  });

  it("GAP-CITIZEN-ALERTS-02/03: counts are case-insensitive and 'Total Published' excludes drafts", async () => {
    getCitizenAlertsMock.mockResolvedValue({
      data: [
        { id: "a1", title: "A", category: "C", publishedDate: "2026-09-01", targetAudience: "All", status: "ACTIVE" },
        { id: "a2", title: "B", category: "C", publishedDate: "2026-09-02", targetAudience: "All", status: "active" },
        { id: "a3", title: "C", category: "C", publishedDate: "2026-09-03", targetAudience: "All", status: "Draft" },
        { id: "a4", title: "D", category: "C", publishedDate: "2026-09-04", targetAudience: "All", status: "expired" },
      ],
      source: "api",
    });
    await render(AlertsPage());

    // Active = 2 (ACTIVE + active, case-insensitive).
    const active = screen.getByText("Active Alerts").closest(".stat") as HTMLElement;
    expect(active).toHaveTextContent("2");
    // Total Published = 3 (all except the 1 draft), NOT 4 (alerts.length).
    const total = screen.getByText("Total Published").closest(".stat") as HTMLElement;
    expect(total).toHaveTextContent("3");
    const drafts = screen.getByText("Drafts").closest(".stat") as HTMLElement;
    expect(drafts).toHaveTextContent("1");
  });

  it("GAP-CITIZEN-ALERTS-04: published date is formatted dd Mon yyyy, not raw ISO", async () => {
    getCitizenAlertsMock.mockResolvedValue({
      data: [
        { id: "a1", title: "Water outage notice", category: "Utilities", publishedDate: "2026-03-05T10:00:00Z", targetAudience: "All wards", status: "Active" },
      ],
      source: "api",
    });
    await render(AlertsPage());

    expect(screen.getByText("05 Mar 2026")).toBeInTheDocument();
    expect(screen.queryByText("2026-03-05T10:00:00Z")).not.toBeInTheDocument();
  });
});
