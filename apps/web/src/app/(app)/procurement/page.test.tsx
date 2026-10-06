import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import en from "@/messages/en.json";

// Resolve translations from the real procurement.hub message tree so the test
// pins the actual user-facing copy (GAP-PROCUREMENT-HOME-02) rather than key
// strings, and would fail on the old hard-coded-English page.
const procMessages = (en as Record<string, unknown>).procurement as {
  title: string;
  hub: Record<string, unknown>;
};
function lookup(obj: unknown, path: string): string {
  const value = path
    .split(".")
    .reduce<unknown>((acc, part) => (acc as Record<string, unknown>)?.[part], obj);
  if (typeof value !== "string") {
    throw new Error(`missing message: ${path}`);
  }
  return value;
}

vi.mock("next-intl/server", () => ({
  getTranslations: async (ns: string) => {
    // Page calls getTranslations("procurement") and getTranslations("procurement.hub").
    const base = ns === "procurement.hub" ? procMessages.hub : procMessages;
    return (key: string) => lookup(base, key);
  },
}));

const mockRoles = vi.fn<() => string[]>();
vi.mock("@/lib/auth/roleGuard", () => ({
  getSessionRoles: () => mockRoles(),
  PROCUREMENT_APPROVER_ROLES: ["procurement_admin", "super_admin"],
}));

// LinkTiles renders the tiles; keep it light but faithful to title output.
vi.mock("../../_components/LinkTiles", () => ({
  LinkTiles: ({ tiles }: { tiles: Array<{ title: string }> }) => (
    <ul>{tiles.map((t) => <li key={t.title}>{t.title}</li>)}</ul>
  ),
}));

import Page from "./page";

describe("Procurement hub role gating (GAP-PROCUREMENT-HOME-01)", () => {
  beforeEach(() => mockRoles.mockReset());

  it("hides approval-sensitive tiles from a plain procurement_officer", async () => {
    mockRoles.mockReturnValue(["procurement_officer"]);
    render(await Page());
    // Approval-gated tiles are not offered.
    expect(screen.queryByText("Approvals")).not.toBeInTheDocument();
    expect(screen.queryByText("Bid Evaluation")).not.toBeInTheDocument();
    expect(screen.queryByText("EMD & BG")).not.toBeInTheDocument();
    expect(screen.queryByText("Empanelment")).not.toBeInTheDocument();
    // Non-gated tiles stay visible.
    expect(screen.getByText("Vendors")).toBeInTheDocument();
    expect(screen.getByText("Purchase Orders")).toBeInTheDocument();
  });

  it("shows all 16 tiles to super_admin", async () => {
    mockRoles.mockReturnValue(["super_admin"]);
    render(await Page());
    expect(screen.getAllByRole("listitem")).toHaveLength(16);
    expect(screen.getByText("Approvals")).toBeInTheDocument();
    expect(screen.getByText("Bid Evaluation")).toBeInTheDocument();
  });

  it("shows approval tiles to procurement_admin", async () => {
    mockRoles.mockReturnValue(["procurement_admin"]);
    render(await Page());
    expect(screen.getByText("Approvals")).toBeInTheDocument();
    expect(screen.getByText("Empanelment")).toBeInTheDocument();
  });
});

describe("Procurement hub i18n (GAP-PROCUREMENT-HOME-02)", () => {
  beforeEach(() => mockRoles.mockReturnValue(["super_admin"]));

  it("renders the subtitle from the message tree, not a hard-coded literal", async () => {
    render(await Page());
    expect(
      screen.getByText("Requisitions, vendors, purchase orders, and tenders with approval controls."),
    ).toBeInTheDocument();
  });

  it("renders tile titles from the procurement.hub.tiles message tree", async () => {
    render(await Page());
    expect(screen.getByText("Annual Plans")).toBeInTheDocument();
    expect(screen.getByText("Goods Receipt")).toBeInTheDocument();
    expect(screen.getByText("Pre-Bid")).toBeInTheDocument();
  });
});
