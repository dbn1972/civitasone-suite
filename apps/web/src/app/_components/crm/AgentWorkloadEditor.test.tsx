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
    fireEvent.change(screen.getByLabelText(/max leads for Asha/i), { target: { value: "15" } });
    fireEvent.click(screen.getByRole("button", { name: "Save capacity for Asha" }));
    await waitFor(() =>
      expect(as.updateAgentCapacity).toHaveBeenCalledWith("a1", { maxLeads: 15, available: true, onLeave: false }),
    );
    expect(await screen.findByText(/capacity saved/i)).toBeInTheDocument();
  });

  it("blocks save when max leads is cleared to a non-number", async () => {
    vi.mocked(as.getAgents).mockResolvedValue({ data: [agent], source: "api" });
    render(<AgentWorkloadEditor />);
    await waitFor(() => expect(screen.getByText("Asha")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/max leads for Asha/i), { target: { value: "" } });
    // Save is disabled while the value is missing (GAP-CRM-AGENT-WORKLOAD-03).
    expect(screen.getByRole("button", { name: "Save capacity for Asha" })).toBeDisabled();
    expect(as.updateAgentCapacity).not.toHaveBeenCalled();
  });

  it("reflects the reloaded server value for the saved row", async () => {
    vi.mocked(as.getAgents)
      .mockResolvedValueOnce({ data: [agent], source: "api" })
      .mockResolvedValueOnce({ data: [{ ...agent, maxLeads: 12 }], source: "api" });
    vi.mocked(as.updateAgentCapacity).mockResolvedValue(undefined);
    render(<AgentWorkloadEditor />);
    await waitFor(() => expect(screen.getByText("Asha")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/max leads for Asha/i), { target: { value: "15" } });
    fireEvent.click(screen.getByRole("button", { name: "Save capacity for Asha" }));
    await waitFor(() => expect(as.updateAgentCapacity).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByLabelText(/max leads for Asha/i)).toHaveValue(12));
    expect(as.getAgents).toHaveBeenCalledTimes(2);
  });

  it("surfaces a failed capacity save and does not claim success", async () => {
    vi.mocked(as.getAgents).mockResolvedValue({ data: [agent], source: "api" });
    vi.mocked(as.updateAgentCapacity).mockRejectedValue(new Error("CAPACITY_LOCKED: no"));
    render(<AgentWorkloadEditor />);
    await waitFor(() => expect(screen.getByText("Asha")).toBeInTheDocument());
    // Raise capacity (non-risky) so it attempts the PATCH directly.
    fireEvent.change(screen.getByLabelText(/max leads for Asha/i), { target: { value: "20" } });
    fireEvent.click(screen.getByRole("button", { name: "Save capacity for Asha" }));
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
    fireEvent.change(screen.getByLabelText(/max leads for Biju/i), { target: { value: "9" } });
    // Raise + save A.
    fireEvent.change(screen.getByLabelText(/max leads for Asha/i), { target: { value: "11" } });
    fireEvent.click(screen.getByRole("button", { name: "Save capacity for Asha" }));
    await waitFor(() => expect(as.updateAgentCapacity).toHaveBeenCalledWith("a1", expect.objectContaining({ maxLeads: 11 })));

    // B's unsaved edit survives (no full "Loading…" flash / table remount).
    expect(screen.getByLabelText(/max leads for Biju/i)).toHaveValue(9);
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
    expect(screen.getByLabelText(/max leads for Asha/i)).toHaveValue(null);
    expect(screen.getByRole("button", { name: "Save capacity for Asha" })).toBeDisabled();
  });
});

// GAP-CRM-AGENT-WORKLOAD-04: risky changes require confirmation + reason.
describe("AgentWorkloadEditor risky-change confirmation (WORKLOAD-04)", () => {
  it("toggling On leave then Save opens a reason dialog; no PATCH until confirmed", async () => {
    vi.mocked(as.getAgents).mockResolvedValue({ data: [agent], source: "api" });
    vi.mocked(as.updateAgentCapacity).mockResolvedValue(undefined);
    render(<AgentWorkloadEditor />);
    await waitFor(() => expect(screen.getByText("Asha")).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText(/on leave: Asha/i));
    fireEvent.click(screen.getByRole("button", { name: "Save capacity for Asha" }));

    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/recorded in the audit trail/i)).toBeInTheDocument();
    expect(as.updateAgentCapacity).not.toHaveBeenCalled();
  });

  it("includes the reason in the PATCH body after confirming", async () => {
    vi.mocked(as.getAgents).mockResolvedValue({ data: [agent], source: "api" });
    vi.mocked(as.updateAgentCapacity).mockResolvedValue(undefined);
    render(<AgentWorkloadEditor />);
    await waitFor(() => expect(screen.getByText("Asha")).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText(/available: Asha/i)); // true -> false (risky)
    fireEvent.click(screen.getByRole("button", { name: "Save capacity for Asha" }));

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
    fireEvent.click(screen.getByLabelText(/on leave: Asha/i));
    fireEvent.click(screen.getByRole("button", { name: "Save capacity for Asha" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /cancel/i }));
    expect(as.updateAgentCapacity).not.toHaveBeenCalled();
  });
});

// GAP-CRM-AGENT-WORKLOAD-05: never show a raw agentId (UUID) as the name.
describe("normaliseAgents name fallback (WORKLOAD-05)", () => {
  it("falls back through displayName/fullName/email, never the agentId", () => {
    const uuid = "3f2a1b4c-0000-4000-8000-000000000001";
    expect(as.normaliseAgents([{ agentId: uuid }])[0]!.name).toBe("Unnamed agent");
    expect(as.normaliseAgents([{ agentId: uuid, displayName: "Asha D" }])[0]!.name).toBe("Asha D");
    expect(as.normaliseAgents([{ agentId: uuid, fullName: "Asha Devi" }])[0]!.name).toBe("Asha Devi");
    expect(as.normaliseAgents([{ agentId: uuid, email: "asha@gov.in" }])[0]!.name).toBe("asha@gov.in");
    // The id is still the stable key, just never the label.
    expect(as.normaliseAgents([{ agentId: uuid }])[0]!.agentId).toBe(uuid);
  });
});

// GAP-CRM-AGENT-WORKLOAD-06: controls labelled by agent name, name is a row header.
describe("AgentWorkloadEditor name-based a11y (WORKLOAD-06)", () => {
  it("labels inputs/checkboxes/Save by the agent's name and makes the name a row header", async () => {
    vi.mocked(as.getAgents).mockResolvedValue({ data: [agent], source: "api" });
    render(<AgentWorkloadEditor />);
    await waitFor(() => expect(screen.getByText("Asha")).toBeInTheDocument());
    expect(screen.getByRole("spinbutton", { name: "Max leads for Asha" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Available: Asha" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "On leave: Asha" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save capacity for Asha" })).toBeInTheDocument();
    // The agent name is a row header (<th scope="row">).
    expect(screen.getByRole("rowheader", { name: "Asha" })).toBeInTheDocument();
  });
});

// GAP-CRM-AGENT-WORKLOAD-07: first-load skeleton + a Retry on error.
describe("AgentWorkloadEditor loading + retry (WORKLOAD-07)", () => {
  it("shows a busy skeleton while the first load is pending", async () => {
    let resolve: (v: { data: as.AgentWorkload[]; source: as.AsSource }) => void = () => {};
    vi.mocked(as.getAgents).mockReturnValue(
      new Promise((r) => { resolve = r; }) as ReturnType<typeof as.getAgents>,
    );
    const { container } = render(<AgentWorkloadEditor />);
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    // Settle so the test teardown is clean.
    resolve({ data: [agent], source: "api" });
    await waitFor(() => expect(screen.getByText("Asha")).toBeInTheDocument());
  });

  it("offers a Retry that re-invokes getAgents after a failed load", async () => {
    vi.mocked(as.getAgents)
      .mockResolvedValueOnce({ data: [], source: "error" })
      .mockResolvedValueOnce({ data: [agent], source: "api" });
    render(<AgentWorkloadEditor />);
    await waitFor(() => expect(screen.getByText(/workload unavailable/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.getByText("Asha")).toBeInTheDocument());
    expect(as.getAgents).toHaveBeenCalledTimes(2);
  });
});
