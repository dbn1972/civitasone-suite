import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const resource = vi.fn();
vi.mock("@/lib/sync/resource", () => ({
  useOfflineResource: () => resource(),
}));

import NotificationTemplatesPage from "./page";

function tpl(partial: Record<string, unknown>) {
  return {
    id: "t1", channel: "in_app", name: "Welcome", subject: null, body: "hi",
    status: "active", version: 1, supersededBy: null, ...partial,
  };
}

function base(over: Record<string, unknown>) {
  return {
    data: [], source: "live", offline: false, cachedAt: null,
    loading: false, revalidating: false, error: null, refresh: vi.fn(),
    ...over,
  };
}

describe("NotificationTemplatesPage", () => {
  beforeEach(() => resource.mockReset());

  it("TEMPLATES-02: collapses versions to latest-per-name by default; toggle reveals all", () => {
    const data = [
      tpl({ id: "v2", name: "Welcome", channel: "email", version: 2, status: "superseded", supersededBy: "v3" }),
      tpl({ id: "v3", name: "Welcome", channel: "email", version: 3, status: "active", supersededBy: null }),
    ];
    resource.mockReturnValue(base({ data }));
    const { container } = render(<NotificationTemplatesPage />);
    const tileFor = (label: string) =>
      Array.from(container.querySelectorAll(".stat")).find((t) => t.querySelector(".lab")?.textContent === label)!;
    // Grouped count = 1 logical template.
    expect(tileFor("Templates").textContent).toContain("1");
    // One row by default (the latest).
    expect(screen.getAllByText("Welcome").length).toBe(1);
    // Toggle shows all versions -> two rows.
    fireEvent.click(screen.getByLabelText(/show all versions/i));
    expect(screen.getAllByText("Welcome").length).toBe(2);
  });

  it("TEMPLATES-03: renders a channel label, not the raw key", () => {
    resource.mockReturnValue(base({ data: [tpl({ channel: "in_app" })] }));
    render(<NotificationTemplatesPage />);
    expect(screen.getByText("In-app")).toBeInTheDocument();
    expect(screen.queryByText("in app")).not.toBeInTheDocument();
  });

  it("TEMPLATES-04: shows '—' stats while loading, not a fabricated 0", () => {
    resource.mockReturnValue(base({ data: [], loading: true }));
    const { container } = render(<NotificationTemplatesPage />);
    const tileFor = (label: string) =>
      Array.from(container.querySelectorAll(".stat")).find((t) => t.querySelector(".lab")?.textContent === label)!;
    expect(tileFor("Templates").textContent).toContain("—");
  });

  it("TEMPLATES-04: shows the saved-data badge when serving cache", () => {
    resource.mockReturnValue(base({ data: [tpl({})], source: "cache", cachedAt: "2026-01-10T00:00:00.000Z" }));
    render(<NotificationTemplatesPage />);
    expect(screen.getByText(/showing saved data/i)).toBeInTheDocument();
  });
});
