import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";

vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  const messages = (await import("@/messages/en.json")).default;
  return {
    getTranslations: async (namespace: string) => createTranslator({ locale: "en", messages, namespace: namespace as never }),
  };
});

const mockRoles = vi.fn<() => string[]>();
vi.mock("@/lib/auth/roleGuard", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth/roleGuard")>("@/lib/auth/roleGuard");
  return { ...actual, getSessionRoles: () => mockRoles() };
});

// LinkTiles renders the tiles; keep it real-ish but light.
vi.mock("../../_components/LinkTiles", () => ({
  LinkTiles: ({ tiles }: { tiles: Array<{ title: string }> }) => (
    <ul>{tiles.map((t) => <li key={t.title}>{t.title}</li>)}</ul>
  ),
}));

import Page from "./page";

describe("CRM hub Configuration gating (GAP-CRM-AGENT-WORKLOAD-01)", () => {
  beforeEach(() => mockRoles.mockReset());

  it("hides the Agent Workload tile from a plain crm_user", async () => {
    mockRoles.mockReturnValue(["crm_user"]);
    render(await Page());
    expect(screen.queryByText("Agent Workload")).not.toBeInTheDocument();
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

// GAP-CRM-HOME-01: ten Configuration routes (plus Document Types, pipelines,
// lead forms, products, service types and grievance categories) bounce a
// crm_user straight back to /crm, so their tiles must not be offered. The
// Configuration section itself stays for the two tiles every CRM role can open.
describe("CRM hub role-filtered tiles (GAP-CRM-HOME-01)", () => {
  beforeEach(() => mockRoles.mockReset());

  const ADMIN_ONLY_TITLES = [
    "Custom Fields", "Duplicate Matching Rules", "Lead Scoring", "Qualification Frameworks",
    "Lead Stage Reasons", "Assignment Rules", "Assignment Directory", "Agent Workload",
    "Lead Escalation Rules", "Task Escalation", "Document Types", "Engagement Pipelines",
    "Website Lead Forms", "Product Catalogue", "Service Types", "Grievance Categories",
  ];

  it("shows a crm_user only the tiles they can open (Document Types and the rest hidden)", async () => {
    mockRoles.mockReturnValue(["crm_user"]);
    render(await Page());
    for (const title of ADMIN_ONLY_TITLES) expect(screen.queryByText(title)).not.toBeInTheDocument();
    // Tiles with no admin gate stay visible, including the two that live in Configuration.
    for (const title of ["Contacts", "Price Books", "Documents", "Data Quality", "Connected Accounts"]) {
      expect(screen.getByText(title)).toBeInTheDocument();
    }
  });

  it("keeps a Configuration section for a crm_user with exactly Data Quality and Connected Accounts", async () => {
    mockRoles.mockReturnValue(["crm_user"]);
    render(await Page());
    const section = screen.getByRole("region", { name: "Configuration" });
    expect(within(section).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "Connected Accounts",
      "Data Quality",
    ]);
  });

  it("shows a crm_admin all 12 Configuration tiles and every admin-gated tile", async () => {
    mockRoles.mockReturnValue(["crm_admin"]);
    render(await Page());
    const section = screen.getByRole("region", { name: "Configuration" });
    expect(within(section).getAllByRole("listitem")).toHaveLength(12);
    for (const title of ADMIN_ONLY_TITLES) expect(screen.getByText(title)).toBeInTheDocument();
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
