import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AgentWorkloadEditor } from "./AgentWorkloadEditor";
import * as as from "@/lib/crm/assignment";

vi.mock("@/lib/crm/assignment", async (orig) => {
  const actual = await orig<typeof import("@/lib/crm/assignment")>();
  return { ...actual, getAgents: vi.fn(), updateAgentCapacity: vi.fn() };
});
const agent: as.AgentWorkload = { agentId: "a1", name: "Asha", activeLeads: 12, maxLeads: 10, available: true, onLeave: false };
beforeEach(() => {
  vi.mocked(as.getAgents).mockReset();
  vi.mocked(as.updateAgentCapacity).mockReset();
});

describe("AgentWorkloadEditor (AS-003 admin)", () => {
  it("gates open-lead counts on a failed load (dash + saved-info badge)", async () => {
    vi.mocked(as.getAgents).mockResolvedValue({ data: [], source: "error" });
    render(<AgentWorkloadEditor />);
    await waitFor(() => expect(screen.getByText(/showing saved information/i)).toBeInTheDocument());
    expect(screen.getByText(/workload unavailable/i)).toBeInTheDocument();
  });

  it("flags agents over capacity and saves capacity via PUT", async () => {
    vi.mocked(as.getAgents).mockResolvedValue({ data: [agent], source: "api" });
    vi.mocked(as.updateAgentCapacity).mockResolvedValue(undefined);
    render(<AgentWorkloadEditor />);
    await waitFor(() => expect(screen.getByText("Asha")).toBeInTheDocument());
    expect(screen.getByText(/\(over\)/i)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/max leads for agent 1/i), { target: { value: "15" } });
    fireEvent.click(screen.getByLabelText(/on leave for agent 1/i));
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() =>
      expect(as.updateAgentCapacity).toHaveBeenCalledWith("a1", { maxLeads: 15, available: true, onLeave: true }),
    );
    expect(await screen.findByText(/capacity saved/i)).toBeInTheDocument();
  });

  it("blocks save when max leads is cleared to a non-number", async () => {
    vi.mocked(as.getAgents).mockResolvedValue({ data: [agent], source: "api" });
    render(<AgentWorkloadEditor />);
    await waitFor(() => expect(screen.getByText("Asha")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/max leads for agent 1/i), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    expect(await screen.findByText(/whole-number lead capacity/i)).toBeInTheDocument();
    expect(as.updateAgentCapacity).not.toHaveBeenCalled();
  });
});
