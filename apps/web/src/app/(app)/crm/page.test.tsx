import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => key,
}));

const mockRoles = vi.fn<() => string[]>();
vi.mock("@/lib/auth/roleGuard", () => ({
  getSessionRoles: () => mockRoles(),
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
