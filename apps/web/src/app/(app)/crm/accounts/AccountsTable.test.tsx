import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as rtlRender, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

function render(ui: ReactElement) {
  return rtlRender(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

vi.mock("@/lib/sync/resource", () => ({ useSeededResource: vi.fn() }));
// RefreshErrorState's retry uses router.refresh(); a bare mock is enough.
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
// F5-01: the Owner column resolves owner ids to names via the agent directory.
vi.mock("@/lib/crm/assignment", () => ({
  getAgents: vi.fn(async () => ({
    data: [{ agentId: "agent-7", name: "Asha Rao", activeLeads: 0, maxLeads: 10, available: true, onLeave: false }],
    source: "api",
  })),
}));

import { useSeededResource } from "@/lib/sync/resource";
import { AccountsTable } from "./AccountsTable";
import type { CRMAccountSummary } from "@civitasone/types";

const mockedHook = vi.mocked(useSeededResource);

function seed(data: CRMAccountSummary[], provenance: "live" | "cached" | "error-no-data") {
  mockedHook.mockReturnValue({
    data,
    provenance,
    offline: false,
    cachedAt: provenance === "cached" ? "2026-10-01T00:00:00.000Z" : null,
    fromCache: provenance === "cached",
  } as unknown as ReturnType<typeof useSeededResource>);
}

const account: CRMAccountSummary = {
  id: "a1",
  name: "NDMA",
  industry: "Disaster Management",
  website: "https://ndma.gov.in",
  contactCount: 2,
  parentId: undefined,
} as unknown as CRMAccountSummary;

describe("AccountsTable outage vs empty (GAP-CRM-ACCOUNTS-01)", () => {
  beforeEach(() => mockedHook.mockReset());

  it("on error-no-data shows a retry, never the 'No accounts yet' empty copy", () => {
    seed([], "error-no-data");
    render(<AccountsTable accounts={[]} source="error" />);
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.queryByText("No accounts yet")).not.toBeInTheDocument();
  });

  it("on a legitimately empty live result shows the empty state, no retry", () => {
    seed([], "live");
    render(<AccountsTable accounts={[]} source="api" />);
    expect(screen.getByText("No accounts yet")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
  });

  it("renders rows when data is present", () => {
    seed([account], "live");
    render(<AccountsTable accounts={[account]} source="api" />);
    expect(screen.getByText("NDMA")).toBeInTheDocument();
    expect(screen.queryByText("No accounts yet")).not.toBeInTheDocument();
  });
});

describe("AccountsTable owner column (F5-01)", () => {
  beforeEach(() => mockedHook.mockReset());

  it("shows 'Unassigned' when an account has no owner, never a raw UUID", () => {
    const unowned = { ...account, ownerId: null } as unknown as CRMAccountSummary;
    seed([unowned], "live");
    render(<AccountsTable accounts={[unowned]} source="api" />);
    expect(screen.getByText("Unassigned")).toBeInTheDocument();
  });

  it("resolves the owner id to a name from the agent directory", async () => {
    const owned = { ...account, ownerId: "agent-7" } as unknown as CRMAccountSummary;
    seed([owned], "live");
    render(<AccountsTable accounts={[owned]} source="api" />);
    // Name resolves asynchronously via getAgents.
    expect(await screen.findByText("Asha Rao")).toBeInTheDocument();
    // The raw owner id must never be rendered.
    expect(screen.queryByText("agent-7")).not.toBeInTheDocument();
  });
});

describe("AccountsTable missing-parent copy (GAP-CRM-ACCOUNTS-08)", () => {
  beforeEach(() => mockedHook.mockReset());

  const child: CRMAccountSummary = {
    id: "c1",
    name: "Directorate",
    industry: "Admin",
    website: "https://d.gov.in",
    contactCount: 1,
    parentId: "p9",
  } as unknown as CRMAccountSummary;

  it("links to the parent's route when the parent is not in the loaded rows", () => {
    seed([child], "live");
    render(<AccountsTable accounts={[child]} source="api" />);
    const link = screen.getByRole("link", { name: "Reports to a parent not shown here" });
    expect(link).toHaveAttribute("href", "/crm/accounts/p9");
  });

  it("shows 'Reports to <name>' when the parent is present in the rows", () => {
    const parent: CRMAccountSummary = {
      id: "p9",
      name: "Ministry",
      industry: "Admin",
      website: "https://m.gov.in",
      contactCount: 0,
      parentId: undefined,
    } as unknown as CRMAccountSummary;
    seed([parent, child], "live");
    render(<AccountsTable accounts={[parent, child]} source="api" />);
    expect(screen.getByText("Reports to Ministry")).toBeInTheDocument();
    expect(
      screen.queryByText("Reports to a parent not shown here"),
    ).not.toBeInTheDocument();
  });
});
