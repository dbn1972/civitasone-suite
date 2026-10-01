import { describe, it, expect, vi } from "vitest";
import type { ReactElement } from "react";

vi.mock("@/lib/auth/roleGuard", () => ({ getSessionRoles: () => ["hr_admin"] }));
vi.mock("@/lib/auth/hrTileAccess", () => ({ hasHrTileAccess: () => true }));
vi.mock("./_components/HRHubNavigation", () => ({ HRHubNavigation: () => null }));
vi.mock("../../_components/ds", () => ({ PageHeader: () => null }));

import Page from "./page";

interface Cat { title: string; tiles: { title: string; href: string }[] }

async function categories(): Promise<Cat[]> {
  const el = (await Page()) as ReactElement<{ children: ReactElement[] }>;
  const hub = (el.props.children as ReactElement<{ categories?: Cat[] }>[]).find((c) => c && typeof c === "object" && "props" in c && c.props.categories);
  return hub!.props.categories!;
}

describe("HR hub tile catalogue (GAP-HR-HOME-04)", () => {
  it("lists each destination href exactly once", async () => {
    const hrefs = (await categories()).flatMap((c) => c.tiles.map((t) => t.href));
    const dupes = hrefs.filter((h, i) => hrefs.indexOf(h) !== i);
    expect(dupes).toEqual([]);
  });

  it("gives the two loan tiles distinct titles", async () => {
    const tiles = (await categories()).flatMap((c) => c.tiles);
    const a = tiles.find((t) => t.href === "/hr/loans")!.title;
    const b = tiles.find((t) => t.href === "/hr/payroll/loans")!.title;
    expect(a).not.toBe(b);
  });
});
