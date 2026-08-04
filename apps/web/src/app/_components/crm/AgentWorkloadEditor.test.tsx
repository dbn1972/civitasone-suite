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

  it("flags agents over capacity and saves capacity via PATCH", async () => {
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

  it("reflects the reloaded server value after save, not optimistic local edits", async () => {
    // Initial load, then a distinct server-canonical reload after the PATCH.
    vi.mocked(as.getAgents)
      .mockResolvedValueOnce({ data: [agent], source: "api" })
      .mockResolvedValueOnce({ data: [{ ...agent, maxLeads: 12, onLeave: true }], source: "api" });
    vi.mocked(as.updateAgentCapacity).mockResolvedValue(undefined);
    render(<AgentWorkloadEditor />);
    await waitFor(() => expect(screen.getByText("Asha")).toBeInTheDocument());
    // Optimistic local edit that the server will NOT echo back.
    fireEvent.change(screen.getByLabelText(/max leads for agent 1/i), { target: { value: "15" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() => expect(as.updateAgentCapacity).toHaveBeenCalled());
    // After the reload the row shows server truth (12), not the local 15.
    await waitFor(() => expect(screen.getByLabelText(/max leads for agent 1/i)).toHaveValue(12));
    expect(screen.getByLabelText(/on leave for agent 1/i)).toBeChecked();
    expect(as.getAgents).toHaveBeenCalledTimes(2);
  });

  it("surfaces a failed capacity save and does not claim success", async () => {
    vi.mocked(as.getAgents).mockResolvedValue({ data: [agent], source: "api" });
    vi.mocked(as.updateAgentCapacity).mockRejectedValue(new Error("CAPACITY_LOCKED: no"));
    render(<AgentWorkloadEditor />);
    await waitFor(() => expect(screen.getByText("Asha")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    expect(await screen.findByText(/capacity_locked/i)).toBeInTheDocument();
    expect(screen.queryByText(/capacity saved/i)).not.toBeInTheDocument();
    // A failed save must not trigger a fabricating reload.
    expect(as.getAgents).toHaveBeenCalledTimes(1);
  });
});
