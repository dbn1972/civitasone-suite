import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

const countersMock = vi.fn();
const auditMock = vi.fn();
const agentsMock = vi.fn();
vi.mock("../_data", () => ({
  getAiGovernanceCounters: () => countersMock(),
  getAiGovernanceAudit: () => auditMock(),
  getAiAgentStatuses: () => agentsMock(),
}));

const rolesMock = vi.fn(() => [] as string[]);
vi.mock("@/lib/auth/roleGuard", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth/roleGuard")>("@/lib/auth/roleGuard");
  return { ...actual, getSessionRoles: () => rolesMock() };
});

import GovernancePage from "./page";

const okCounters = { data: { totalInvocations: 400, blockedCount: 8, blockRatePct: 2, activeAgents: 3 }, source: "api" as const };
const okAudit = { data: [], source: "api" as const };
const okAgents = { data: [{ id: "a1", name: "Drafter", status: "active" }], source: "api" as const };

describe("GovernancePage (GAP-AI-GOVERNANCE-01/03/04/05)", () => {
  beforeEach(() => { countersMock.mockReset(); auditMock.mockReset(); agentsMock.mockReset(); rolesMock.mockReset(); rolesMock.mockReturnValue([]); });

  it("GOVERNANCE-01: counters error -> stats '—' and no 'Within normal range' band", async () => {
    countersMock.mockResolvedValue({ data: null, source: "error" });
    auditMock.mockResolvedValue(okAudit);
    agentsMock.mockResolvedValue(okAgents);
    render(await GovernancePage({}));
    expect(screen.queryByText("Within normal range")).not.toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(4);
  });

  it("GOVERNANCE-01: agents error -> retry state, not 'No agents defined'", async () => {
    countersMock.mockResolvedValue(okCounters);
    auditMock.mockResolvedValue(okAudit);
    agentsMock.mockResolvedValue({ data: [], source: "error" });
    render(await GovernancePage({}));
    expect(screen.queryByText("No agents defined")).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /try again/i }).length).toBeGreaterThanOrEqual(1);
  });

  it("GOVERNANCE-01: healthy counters show the normal band", async () => {
    countersMock.mockResolvedValue(okCounters);
    auditMock.mockResolvedValue(okAudit);
    agentsMock.mockResolvedValue(okAgents);
    render(await GovernancePage({}));
    expect(screen.getByText("Within normal range")).toBeInTheDocument();
  });

  it("GOVERNANCE-03: reasons card shows its 'latest 100' scope label", async () => {
    countersMock.mockResolvedValue(okCounters);
    auditMock.mockResolvedValue({
      data: [{ id: "e1", agentId: "a1", action: "invoke", blocked: true, reason: "pii", createdAt: "2026-08-01T10:00:00.000Z" }],
      source: "api",
    });
    agentsMock.mockResolvedValue(okAgents);
    render(await GovernancePage({}));
    expect(screen.getByText(/From the latest 100 audit entries/i)).toBeInTheDocument();
  });

  it("GOVERNANCE-04: audit entry shows the agent name, not the raw id", async () => {
    countersMock.mockResolvedValue(okCounters);
    auditMock.mockResolvedValue({
      data: [{ id: "e1", agentId: "a1", action: "invoke", blocked: false, reason: null, createdAt: "2026-08-01T10:00:00.000Z" }],
      source: "api",
    });
    agentsMock.mockResolvedValue(okAgents);
    render(await GovernancePage({}));
    // "Drafter" appears both in the audit cell and the kill-switch list; the
    // point is the raw id "a1" is NOT shown as the agent cell text.
    expect(screen.getAllByText("Drafter").length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText("a1")).not.toBeInTheDocument();
  });

  it("GOVERNANCE-05: a non-admin sees the kill-switch disabled with an explanation", async () => {
    rolesMock.mockReturnValue(["ai_user"]);
    countersMock.mockResolvedValue(okCounters);
    auditMock.mockResolvedValue(okAudit);
    agentsMock.mockResolvedValue(okAgents);
    render(await GovernancePage({}));
    expect(screen.getByText(/requires the AI administrator role/i)).toBeInTheDocument();
    const pauseBtn = screen.getByRole("button", { name: "Pause" });
    expect(pauseBtn).toBeDisabled();
  });

  it("GOVERNANCE-05: an ai_admin can operate the kill-switch", async () => {
    rolesMock.mockReturnValue(["ai_admin"]);
    countersMock.mockResolvedValue(okCounters);
    auditMock.mockResolvedValue(okAudit);
    agentsMock.mockResolvedValue(okAgents);
    render(await GovernancePage({}));
    expect(screen.getByRole("button", { name: "Pause" })).not.toBeDisabled();
  });
});
