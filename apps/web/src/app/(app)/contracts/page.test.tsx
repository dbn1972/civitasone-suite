import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// GAP-CONTRACTS-HOME-01: every ModuleHub href on the Contracts hub must
// resolve to a real route under (app)/contracts. A tile pointing at a
// non-existent route (the old "Rate Contracts" -> /contracts/rate-contracts)
// is a dead tile: the dynamic [id] segment swallows the click and renders the
// "Contract not found" state. This test fails on the old code and pins the
// hub so a future dead tile is caught.

// Keep ModuleHub a pure render (its default export is a server component that
// only lays out static tiles) by stubbing the role-gate helper it imports.
vi.mock("@/lib/auth/roleGuard", () => ({
  getSessionRoles: () => [],
  hasAnyRole: () => true,
}));

const summaryMock = vi.fn();
vi.mock("../../_data/loaders", () => ({
  getContractExpirySummary: () => summaryMock(),
}));

import Page from "./page";

const here = dirname(fileURLToPath(import.meta.url));

function routeExists(href: string): boolean {
  // Only validate routes inside this module's own folder.
  if (!href.startsWith("/contracts")) return true;
  const rest = href.slice("/contracts".length).replace(/^\//, ""); // "" | "list" | "new" | ...
  if (rest === "") return true; // the hub itself
  const seg = rest.split("/")[0]!;
  // A literal child folder (list, new, ...) OR the dynamic [id] segment.
  return existsSync(join(here, seg)) || existsSync(join(here, "[id]"));
}

describe("Contracts hub", () => {
  beforeEach(() => {
    summaryMock.mockReset();
    summaryMock.mockResolvedValue({
      data: { in30: 2, in60: 5, in90: 9, expired: 1 },
      source: "api",
    });
  });

  it("renders no link to a route that does not exist (no dead Rate Contracts tile)", async () => {
    render(await Page());
    expect(screen.queryByText("Rate Contracts")).not.toBeInTheDocument();

    const links = screen.getAllByRole("link");
    expect(links.length).toBeGreaterThan(0);
    for (const a of links) {
      const href = a.getAttribute("href") ?? "";
      if (href.startsWith("/contracts")) {
        expect(href).not.toContain("rate-contracts");
        expect(routeExists(href)).toBe(true);
      }
    }
  });

  it("links to the two real routes: the list and the new-contract form", async () => {
    render(await Page());
    const listLinks = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(listLinks).toContain("/contracts/list");
    expect(listLinks).toContain("/contracts/new");
  });

  it("shows the expiry summary buckets computed from the register", async () => {
    render(await Page());
    expect(screen.getByText("Expiring in 30 days")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument(); // in30
    expect(screen.getByText("1")).toBeInTheDocument(); // expired
  });

  it("shows dashes, not zeros, when the summary could not be loaded", async () => {
    summaryMock.mockResolvedValue({ data: null, source: "error", status: 500 });
    render(await Page());
    // StatCard renders "—" for a null value; no fabricated 0 anywhere.
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(4);
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });
});
