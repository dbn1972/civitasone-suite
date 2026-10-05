import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  const messages = (await import("@/messages/en.json")).default;
  return {
    getTranslations: async (namespace: string) => createTranslator({ locale: "en", messages, namespace: namespace as never }),
  };
});

const mockRoles = vi.fn<() => string[]>();
vi.mock("@/lib/auth/roleGuard", () => ({
  getSessionRoles: () => mockRoles(),
  CRM_ADMIN_ROLES: ["crm_admin", "admin", "super_admin", "platform_admin", "tenant_admin"],
}));

// LinkTiles renders the tiles; keep it real-ish but light.
vi.mock("../../_components/LinkTiles", () => ({
  LinkTiles: ({ tiles }: { tiles: Array<{ title: string }> }) => (
    <ul>{tiles.map((t) => <li key={t.title}>{t.title}</li>)}</ul>
  ),
}));

import Page from "./page";

describe("CRM hub Configuration gating (GAP-CRM-AGENT-WORKLOAD-01)", () => {
  beforeEach(() => mockRoles.mockReset());

  it("hides the Configuration section (and Agent Workload tile) from a plain crm_user", async () => {
    mockRoles.mockReturnValue(["crm_user"]);
    render(await Page());
    expect(screen.queryByText("Agent Workload")).not.toBeInTheDocument();
    expect(screen.queryByText("Configuration")).not.toBeInTheDocument();
    // Core tiles still visible.
    expect(screen.getByText("Contacts")).toBeInTheDocument();
  });

  it("shows the Configuration section and Agent Workload tile to crm_admin", async () => {
    mockRoles.mockReturnValue(["crm_admin"]);
    render(await Page());
    expect(screen.getByText("Agent Workload")).toBeInTheDocument();
    expect(screen.getByText("Configuration")).toBeInTheDocument();
  });
});

describe("CRM hub vocabulary (GAP-CRM-HOME-02)", () => {
  beforeEach(() => mockRoles.mockReturnValue(["crm_admin"]));

  it("labels the Engagements tile to match the destination page title, not 'Deals'", async () => {
    render(await Page());
    // deals/page.tsx renders PageHeader title "Vendor / Stakeholder Engagements".
    expect(screen.getByText("Vendor / Stakeholder Engagements")).toBeInTheDocument();
    expect(screen.queryByText("Deals")).not.toBeInTheDocument();
  });

  it("uses no 'Sales' wording anywhere in the hub", async () => {
    render(await Page());
    expect(screen.queryByText(/Sales/i)).not.toBeInTheDocument();
    // Section heading and pipeline tile reworded to the engagement vocabulary.
    expect(screen.getByText("Engagement Pipeline")).toBeInTheDocument();
    expect(screen.getByText("Engagement Pipelines")).toBeInTheDocument();
  });
});

describe("CRM hub i18n (GAP-CRM-HOME-03)", () => {
  beforeEach(() => mockRoles.mockReturnValue(["crm_admin"]));

  it("renders the subtitle, section headings and tiles from the crm.hub message tree", async () => {
    render(await Page());
    // Subtitle resolved via t('subtitle'), not a hard-coded literal.
    expect(screen.getByText("Pipeline and customer operations workspace.")).toBeInTheDocument();
    // Section headings resolved via t('sections.*').
    expect(screen.getByText("Core")).toBeInTheDocument();
    expect(screen.getByText("Service & Engagement")).toBeInTheDocument();
    // A representative tile from each resolves via t('tiles.*').
    expect(screen.getByText("Account Health")).toBeInTheDocument();
  });

  it("uses the module name 'CRM' for the hub title, not 'Citizen Services'", async () => {
    render(await Page());
    expect(screen.getByRole("heading", { level: 1, name: "CRM" })).toBeInTheDocument();
    expect(screen.queryByText("Citizen Services")).not.toBeInTheDocument();
  });
});
