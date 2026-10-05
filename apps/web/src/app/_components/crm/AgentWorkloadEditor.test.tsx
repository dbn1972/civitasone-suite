import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as rtlRender, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import { AgentWorkloadEditor } from "./AgentWorkloadEditor";
import * as as from "@/lib/crm/assignment";

function render(ui: React.ReactElement) {
  return rtlRender(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

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
    await waitFor(() => expect(screen.getByText("Couldn't load — showing nothing")).toBeInTheDocument());
    expect(screen.getByText(/workload unavailable/i)).toBeInTheDocument();
  });

  it("saves a non-risky capacity change (raise) via PATCH without a dialog", async () => {
    vi.mocked(as.getAgents).mockResolvedValue({ data: [agent], source: "api" });
    vi.mocked(as.updateAgentCapacity).mockResolvedValue(undefined);
    render(<AgentWorkloadEditor />);
    await waitFor(() => expect(screen.getByText("Asha")).toBeInTheDocument());
    expect(screen.getByText(/\(over\)/i)).toBeInTheDocument();
    // Raise capacity (not risky) and save — no confirm needed.
    fireEvent.change(screen.getByLabelText(/max leads for agent 1/i), { target: { value: "15" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() =>
      expect(as.updateAgentCapacity).toHaveBeenCalledWith("a1", { maxLeads: 15, available: true, onLeave: false }),
    );
    expect(await screen.findByText(/capacity saved/i)).toBeInTheDocument();
  });

  it("blocks save when max leads is cleared to a non-number", async () => {
    vi.mocked(as.getAgents).mockResolvedValue({ data: [agent], source: "api" });
    render(<AgentWorkloadEditor />);
    await waitFor(() => expect(screen.getByText("Asha")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/max leads for agent 1/i), { target: { value: "" } });
    // Save is disabled while the value is missing (GAP-CRM-AGENT-WORKLOAD-03).
    expect(screen.getByRole("button", { name: /^save$/i })).toBeDisabled();
    expect(as.updateAgentCapacity).not.toHaveBeenCalled();
  });

  it("reflects the reloaded server value for the saved row", async () => {
    vi.mocked(as.getAgents)
      .mockResolvedValueOnce({ data: [agent], source: "api" })
      .mockResolvedValueOnce({ data: [{ ...agent, maxLeads: 12 }], source: "api" });
    vi.mocked(as.updateAgentCapacity).mockResolvedValue(undefined);
    render(<AgentWorkloadEditor />);
    await waitFor(() => expect(screen.getByText("Asha")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/max leads for agent 1/i), { target: { value: "15" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() => expect(as.updateAgentCapacity).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByLabelText(/max leads for agent 1/i)).toHaveValue(12));
    expect(as.getAgents).toHaveBeenCalledTimes(2);
  });

  it("surfaces a failed capacity save and does not claim success", async () => {
    vi.mocked(as.getAgents).mockResolvedValue({ data: [agent], source: "api" });
    vi.mocked(as.updateAgentCapacity).mockRejectedValue(new Error("CAPACITY_LOCKED: no"));
    render(<AgentWorkloadEditor />);
    await waitFor(() => expect(screen.getByText("Asha")).toBeInTheDocument());
    // Raise capacity (non-risky) so it attempts the PATCH directly.
    fireEvent.change(screen.getByLabelText(/max leads for agent 1/i), { target: { value: "20" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    expect(await screen.findByText(/capacity_locked/i)).toBeInTheDocument();
    expect(screen.queryByText(/capacity saved/i)).not.toBeInTheDocument();
  });
});

// GAP-CRM-AGENT-WORKLOAD-02: saving one row keeps unsaved edits on other rows.
describe("AgentWorkloadEditor keeps unsaved edits on other rows (WORKLOAD-02)", () => {
  const two: as.AgentWorkload[] = [
    { agentId: "a1", name: "Asha", activeLeads: 2, maxLeads: 10, available: true, onLeave: false },
    { agentId: "a2", name: "Biju", activeLeads: 1, maxLeads: 5, available: true, onLeave: false },
  ];

  it("saving agent A does not discard agent B's unsaved maxLeads edit", async () => {
    vi.mocked(as.getAgents).mockResolvedValue({ data: two, source: "api" });
    vi.mocked(as.updateAgentCapacity).mockResolvedValue(undefined);
    render(<AgentWorkloadEditor />);
    await waitFor(() => expect(screen.getByText("Asha")).toBeInTheDocument());

    // Edit B (raise 5→9, non-risky) but DON'T save it.
    fireEvent.change(screen.getByLabelText(/max leads for agent 2/i), { target: { value: "9" } });
    // Raise + save A.
    fireEvent.change(screen.getByLabelText(/max leads for agent 1/i), { target: { value: "11" } });
    const saveButtons = screen.getAllByRole("button", { name: /^save$/i });
    fireEvent.click(saveButtons[0]);
    await waitFor(() => expect(as.updateAgentCapacity).toHaveBeenCalledWith("a1", expect.objectContaining({ maxLeads: 11 })));

    // B's unsaved edit survives (no full "Loading…" flash / table remount).
    expect(screen.getByLabelText(/max leads for agent 2/i)).toHaveValue(9);
    expect(screen.queryByText("Loading agent workload…")).not.toBeInTheDocument();
  });
});

// GAP-CRM-AGENT-WORKLOAD-03: 0-capacity help + missing stays NaN.
describe("AgentWorkloadEditor max-leads semantics (WORKLOAD-03)", () => {
  it("exposes help text describing what max leads = 0 means", async () => {
    vi.mocked(as.getAgents).mockResolvedValue({ data: [agent], source: "api" });
    render(<AgentWorkloadEditor />);
    await waitFor(() => expect(screen.getByText("Asha")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /what is max leads/i }));
    expect(screen.getByText(/receives no new leads/i)).toBeInTheDocument();
  });

  it("shows a 'Blocked' hint when max leads is 0", async () => {
    vi.mocked(as.getAgents).mockResolvedValue({ data: [{ ...agent, maxLeads: 0 }], source: "api" });
    render(<AgentWorkloadEditor />);
    await waitFor(() => expect(screen.getByText("Asha")).toBeInTheDocument());
    expect(screen.getByText(/Blocked — no new leads/i)).toBeInTheDocument();
  });

  it("keeps a missing maxLeads empty (not 0) and disables Save until entered", async () => {
    const missing = { agentId: "a1", name: "Asha", activeLeads: 0, maxLeads: Number.NaN, available: true, onLeave: false };
    vi.mocked(as.getAgents).mockResolvedValue({ data: [missing] as never, source: "api" });
    render(<AgentWorkloadEditor />);
    await waitFor(() => expect(screen.getByText("Asha")).toBeInTheDocument());
    expect(screen.getByLabelText(/max leads for agent 1/i)).toHaveValue(null);
    expect(screen.getByRole("button", { name: /^save$/i })).toBeDisabled();
  });
});

// GAP-CRM-AGENT-WORKLOAD-04: risky changes require confirmation + reason.
describe("AgentWorkloadEditor risky-change confirmation (WORKLOAD-04)", () => {
  it("toggling On leave then Save opens a reason dialog; no PATCH until confirmed", async () => {
    vi.mocked(as.getAgents).mockResolvedValue({ data: [agent], source: "api" });
    vi.mocked(as.updateAgentCapacity).mockResolvedValue(undefined);
    render(<AgentWorkloadEditor />);
    await waitFor(() => expect(screen.getByText("Asha")).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText(/on leave for agent 1/i));
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/recorded in the audit trail/i)).toBeInTheDocument();
    expect(as.updateAgentCapacity).not.toHaveBeenCalled();
  });

  it("includes the reason in the PATCH body after confirming", async () => {
    vi.mocked(as.getAgents).mockResolvedValue({ data: [agent], source: "api" });
    vi.mocked(as.updateAgentCapacity).mockResolvedValue(undefined);
    render(<AgentWorkloadEditor />);
    await waitFor(() => expect(screen.getByText("Asha")).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText(/available for agent 1/i)); // true -> false (risky)
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    const dialog = await screen.findByRole("alertdialog");
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "Reassigned to backup team" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /save change/i }));

    await waitFor(() =>
      expect(as.updateAgentCapacity).toHaveBeenCalledWith(
        "a1",
        expect.objectContaining({ available: false, reason: "Reassigned to backup team" }),
      ),
    );
  });

  it("cancelling the dialog sends no PATCH", async () => {
    vi.mocked(as.getAgents).mockResolvedValue({ data: [agent], source: "api" });
    render(<AgentWorkloadEditor />);
    await waitFor(() => expect(screen.getByText("Asha")).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText(/on leave for agent 1/i));
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /cancel/i }));
    expect(as.updateAgentCapacity).not.toHaveBeenCalled();
  });
});
