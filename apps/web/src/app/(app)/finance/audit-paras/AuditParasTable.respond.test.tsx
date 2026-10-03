import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/lib/sync/resource", () => ({ useSeededResource: vi.fn() }));
import { useSeededResource } from "@/lib/sync/resource";
import { AuditParasTable } from "./AuditParasTable";

const mockedHook = vi.mocked(useSeededResource);
const para = (id: string, paraNo: string, status: string) => ({ id, paraNo, source: "CAG", dept: "Education", moneyValueMinor: "100000", status, createdAt: "2026-09-01T00:00:00Z" });

describe("AuditParasTable Respond action (GAP-FINANCE-AUDIT-PARAS-05)", () => {
  beforeEach(() => mockedHook.mockReset());
  const seed = () => mockedHook.mockReturnValue({ data: [para("a", "P-1", "open"), para("b", "P-2", "escalated"), para("c", "P-3", "settled")], offline: false, cachedAt: null, provenance: "live" } as never);

  it("links open and escalated paras to their detail page, for roles that may respond", () => {
    seed();
    render(<AuditParasTable paras={[]} source="api" canRespond />);
    expect(screen.getByRole("link", { name: "Respond to audit para P-1" }).getAttribute("href")).toBe("/finance/audit-paras/a");
    expect(screen.getByRole("link", { name: "Respond to audit para P-2" }).getAttribute("href")).toBe("/finance/audit-paras/b");
    expect(screen.queryByRole("link", { name: "Respond to audit para P-3" })).not.toBeInTheDocument();
  });

  it("offers no Respond link to a read-only role", () => {
    seed();
    render(<AuditParasTable paras={[]} source="api" />);
    expect(screen.queryByRole("link", { name: /Respond to audit para/ })).not.toBeInTheDocument();
  });
});
