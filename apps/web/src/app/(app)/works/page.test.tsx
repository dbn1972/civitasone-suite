import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import en from "@/messages/en.json";
import hi from "@/messages/hi.json";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));

let roles: string[] = ["works_admin"];
vi.mock("@/lib/auth/roleGuard", () => ({
  getSessionRoles: () => roles,
}));

// Real-catalogue translator so the hi-locale test proves translated copy, not
// just key echoes (mirrors assets/page.test.tsx).
let messages: Record<string, unknown> = en as Record<string, unknown>;
vi.mock("next-intl/server", () => ({
  getTranslations: async (ns: string) => (key: string) => {
    const hit = `${ns}.${key}`.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], messages);
    if (typeof hit !== "string") throw new Error(`missing message ${ns}.${key}`);
    return hit;
  },
}));

import WorksHub from "./page";

function apiOk(byStatus: Record<string, number> = { draft: 1 }) {
  fetchJsonMock.mockResolvedValue({
    data: { totalWorks: 3, activeWorks: 2, closedWorks: 1, byStatus },
    source: "api",
  });
}

describe("WorksHub — navigation integrity (L1)", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    roles = ["works_admin"];
    messages = en as Record<string, unknown>;
    apiOk();
  });

  it("points the Procurement tile at the real /procurement module, not the dead /works/procurement", async () => {
    const ui = await WorksHub();
    const { container } = render(ui);
    const procurement = screen.getByRole("link", { name: /Procurement/i });
    expect(procurement).toHaveAttribute("href", "/procurement");
    expect(container.querySelector('a[href="/works/procurement"]')).toBeNull();
  });

  it("renders the module tiles with the live dashboard KPIs", async () => {
    const ui = await WorksHub();
    render(ui);
    expect(screen.getByRole("link", { name: /Work Proposals/i })).toHaveAttribute("href", "/works/proposals");
    expect(screen.getByText("Total Works")).toBeInTheDocument();
  });
});

describe("WorksHub — GAP-WORKS-HOME-01 FAILMASK", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    roles = ["works_admin"];
    messages = en as Record<string, unknown>;
  });

  it("renders five '—' stat values (not zeros) when the dashboard fetch fails", async () => {
    fetchJsonMock.mockResolvedValue({
      data: { totalWorks: 0, activeWorks: 0, closedWorks: 0, byStatus: {} },
      source: "error",
    });
    const { container } = render(await WorksHub());
    const dashes = Array.from(container.querySelectorAll(".stat .val")).map((n) => n.textContent);
    expect(dashes).toEqual(["—", "—", "—", "—", "—"]);
    // the honest load-failure badge is shown
    expect(screen.getByText("Couldn't load dashboard figures")).toBeInTheDocument();
    // and no fabricated 0 is rendered as a stat value
    expect(dashes).not.toContain("0");
  });

  it("renders real zeros on a successful but empty dashboard", async () => {
    fetchJsonMock.mockResolvedValue({
      data: { totalWorks: 0, activeWorks: 0, closedWorks: 0, byStatus: {} },
      source: "api",
    });
    const { container } = render(await WorksHub());
    const vals = Array.from(container.querySelectorAll(".stat .val")).map((n) => n.textContent);
    expect(vals).toEqual(["0", "0", "0", "0", "0"]);
    expect(screen.queryByText("Couldn't load dashboard figures")).not.toBeInTheDocument();
  });
});

describe("WorksHub — GAP-WORKS-HOME-02 real status vocabulary", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    roles = ["works_admin"];
    messages = en as Record<string, unknown>;
  });

  it("derives Pending from dao_finalized + ts_eligible (the real backend keys), not submitted/pending", async () => {
    apiOk({ draft: 4, dao_finalized: 3, ts_eligible: 2 });
    const { container } = render(await WorksHub());
    const vals = Array.from(container.querySelectorAll(".stat")).map((card) => ({
      label: card.querySelector(".lab")?.textContent,
      value: card.querySelector(".val")?.textContent,
    }));
    const draft = vals.find((v) => v.label === "Draft");
    const pending = vals.find((v) => v.label === "Pending");
    expect(draft?.value).toBe("4");
    expect(pending?.value).toBe("5"); // 3 + 2 — would be 0 under the old submitted/pending read
  });

  it("shows Pending 0 when only drafts exist (old code would also read 0 but for the wrong reason)", async () => {
    apiOk({ draft: 7 });
    const { container } = render(await WorksHub());
    const pending = Array.from(container.querySelectorAll(".stat")).find(
      (c) => c.querySelector(".lab")?.textContent === "Pending",
    );
    expect(pending?.querySelector(".val")?.textContent).toBe("0");
  });
});

describe("WorksHub — GAP-WORKS-HOME-03 i18n + icons", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    roles = ["works_admin"];
    apiOk();
  });

  it("renders tile labels from the Hindi catalogue under the hi locale", async () => {
    messages = hi as Record<string, unknown>;
    render(await WorksHub());
    expect(screen.getByText("कार्य प्रस्ताव")).toBeInTheDocument(); // Work Proposals
    expect(screen.getByText("निविदा पाइपलाइन")).toBeInTheDocument(); // Tender Pipeline
    expect(screen.queryByText("Work Proposals")).not.toBeInTheDocument();
    messages = en as Record<string, unknown>;
  });

  it("renders tile icons as inline SVG (lucide), not raw emoji text nodes", async () => {
    messages = en as Record<string, unknown>;
    const { container } = render(await WorksHub());
    // every module tile link carries a lucide <svg> icon
    const svgs = container.querySelectorAll("svg");
    expect(svgs.length).toBeGreaterThanOrEqual(8);
    // no module-tile label is a bare emoji glyph
    expect(container.textContent).not.toMatch(/📋|📢|🏢|🏗|💰|📦|📚|📊/);
  });
});

describe("WorksHub — GAP-WORKS-HOME-05 role-gated tiles", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    messages = en as Record<string, unknown>;
    apiOk();
  });

  it("shows Masters and Reports tiles to a works_operator (a reader role)", async () => {
    roles = ["works_operator"];
    render(await WorksHub());
    expect(screen.getByRole("link", { name: /Masters Registry/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Reports/i })).toBeInTheDocument();
  });

  it("hides Masters and Reports tiles from a role outside the works reader set", async () => {
    roles = ["citizen"];
    const { container } = render(await WorksHub());
    expect(container.querySelector('a[href="/works/masters"]')).toBeNull();
    expect(container.querySelector('a[href="/works/reports"]')).toBeNull();
    // read-only non-admin: no Quick Actions card
    expect(screen.queryByText("Quick Actions")).not.toBeInTheDocument();
  });

  it("shows Quick Actions only to a works admin role", async () => {
    roles = ["works_admin"];
    render(await WorksHub());
    expect(screen.getByText("Quick Actions")).toBeInTheDocument();
  });
});
