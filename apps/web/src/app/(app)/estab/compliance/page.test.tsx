import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const getEstabCompliance = vi.fn();
const getSessionRoles = vi.fn();
vi.mock("../../../_data/loaders", () => ({ getEstabCompliance: (...a: unknown[]) => getEstabCompliance(...a) }));
vi.mock("@/lib/auth/roleGuard", () => ({
  getSessionRoles: () => getSessionRoles(),
  hasAnyRole: (have: string[], allowed: string[]) => allowed.some((r) => have.includes(r)),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import CompliancePage from "./page";

const item = (over: Record<string, unknown>) => ({
  id: "c1", complianceCode: "RTI-1", title: "File RTI report", category: "RTI", frequency: "annual",
  dueDate: "2099-01-01", status: "pending", ...over,
});

describe("CompliancePage", () => {
  beforeEach(() => {
    getEstabCompliance.mockReset();
    getSessionRoles.mockReset().mockReturnValue(["estab_officer"]);
  });

  it("GAP-ESTAB-COMPLIANCE-02: Given an empty register, When it renders, Then the rate tile is an em dash, not 0%", async () => {
    getEstabCompliance.mockResolvedValue({ data: [], source: "api" });
    render(await CompliancePage());
    const tile = screen.getByText("Compliance Rate").closest("div") as HTMLElement;
    expect(tile.parentElement?.textContent).toContain("—");
    expect(document.body.textContent).not.toContain("0%");
  });

  it("GAP-ESTAB-COMPLIANCE-02: Given 1 of 2 items complied, Then the rate is 50%", async () => {
    getEstabCompliance.mockResolvedValue({ data: [item({ status: "complied" }), item({ id: "c2" })], source: "api" });
    render(await CompliancePage());
    expect(document.body.textContent).toContain("50%");
  });

  it("GAP-ESTAB-COMPLIANCE-01: Given an item overdue by 1 day and another by 10 days, Then only the 10-day item counts as escalated", async () => {
    const day = 86_400_000;
    const ymd = (offsetDays: number) => new Date(Date.now() - offsetDays * day).toISOString().slice(0, 10);
    getEstabCompliance.mockResolvedValue({
      data: [item({ id: "a", status: "overdue", dueDate: ymd(1) }), item({ id: "b", status: "overdue", dueDate: ymd(10) })],
      source: "api",
    });
    render(await CompliancePage());
    const label = screen.getByText(/Escalated \(> 7d overdue\)/);
    expect(label.parentElement?.textContent?.replace(/\D/g, "")).toBe("7" + "1");
  });

  it("GAP-ESTAB-COMPLIANCE-03: Given an audit officer, Then no Mark complied action is offered", async () => {
    getSessionRoles.mockReturnValue(["audit_officer"]);
    getEstabCompliance.mockResolvedValue({ data: [item({})], source: "api" });
    render(await CompliancePage());
    expect(screen.queryByRole("button", { name: /mark complied/i })).not.toBeInTheDocument();
  });

  it("GAP-ESTAB-COMPLIANCE-03: Given an estab officer, Then Mark complied is offered for an open item", async () => {
    getEstabCompliance.mockResolvedValue({ data: [item({})], source: "api" });
    render(await CompliancePage());
    expect(screen.getByRole("button", { name: /mark complied/i })).toBeInTheDocument();
  });
});
