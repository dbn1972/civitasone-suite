import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { formatIndianDateTime } from "@/lib/formatters";

vi.mock("@/lib/sync/resource", () => ({
  useSeededResource: (_k: string, rows: unknown) => ({ data: rows, fromCache: true, offline: false, cachedAt: "2026-10-21T20:30:00Z" }),
}));

import { KpiTable } from "./KpiTable";

describe("KpiTable cache note (CLOS-S1-16)", () => {
  it("shows the cached-at time in IST via formatIndianDateTime", () => {
    render(<KpiTable rows={[]} />);
    const expected = formatIndianDateTime("2026-10-21T20:30:00Z");
    expect(expected).toMatch(/22/); // 20:30Z is already 22 Oct in IST
    expect(screen.getByText(new RegExp(`Showing saved data from ${expected}`))).toBeInTheDocument();
  });
});
