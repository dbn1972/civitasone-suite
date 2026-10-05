import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));

import { LeadAssignmentControl } from "./LeadAssignmentControl";
import * as as from "@/lib/crm/assignment";

vi.mock("@/lib/crm/assignment", async (orig) => {
  const actual = await orig<typeof import("@/lib/crm/assignment")>();
  return {
    ...actual,
    assignLead: vi.fn(),
    acceptLead: vi.fn(),
    transferOwnership: vi.fn(),
    getAgents: vi.fn(),
  };
});

const AGENTS = [
  { agentId: "u7", name: "Nita Shah", activeLeads: 2, maxLeads: 10, available: true, onLeave: false },
  { agentId: "u9", name: "Omar Khan", activeLeads: 1, maxLeads: 10, available: true, onLeave: false },
];

beforeEach(() => {
  refresh.mockReset();
  vi.mocked(as.assignLead).mockReset();
  vi.mocked(as.acceptLead).mockReset();
  vi.mocked(as.transferOwnership).mockReset();
  vi.mocked(as.getAgents).mockReset();
  vi.mocked(as.getAgents).mockResolvedValue({ data: AGENTS, source: "api" });
});

describe("LeadAssignmentControl (AS-001/002/004)", () => {
  it("runs the rule chain via ConfirmDialog (sync wording on 200)", async () => {
    vi.mocked(as.assignLead).mockResolvedValue({ accepted: false });
    render(<NextIntlClientProvider locale="en" messages={enMessages}><LeadAssignmentControl leadId="l1" /></NextIntlClientProvider>);
    fireEvent.click(screen.getByRole("button", { name: /run assignment rules/i }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /assign lead/i }));
    await waitFor(() => expect(as.assignLead).toHaveBeenCalledWith("l1", { runRules: true }));
    expect(await screen.findByText(/assigned by the rule chain/i)).toBeInTheDocument();
    expect(refresh).toHaveBeenCalled();
  });

  it("requires an owner selection for specific-owner assign, then sends the chosen ownerId and name", async () => {
    vi.mocked(as.assignLead).mockResolvedValue({ accepted: true });
    render(<NextIntlClientProvider locale="en" messages={enMessages}><LeadAssignmentControl leadId="l1" /></NextIntlClientProvider>);
    fireEvent.click(screen.getByRole("tab", { name: /specific owner/i }));
    fireEvent.click(screen.getByRole("button", { name: /assign to owner/i }));
    expect(await screen.findByText(/choose the owner to assign/i)).toBeInTheDocument();
    expect(as.assignLead).not.toHaveBeenCalled();

    // Pick an owner by name from the directory (no hand-typed UUID).
    const picker = screen.getByLabelText(/owner to assign this lead to/i);
    fireEvent.change(picker, { target: { value: "Nita" } });
    fireEvent.mouseDown(await screen.findByText("Nita Shah"));
    await screen.findByDisplayValue("Nita Shah");

    fireEvent.click(screen.getByRole("button", { name: /assign to owner/i }));
    const dialog = await screen.findByRole("alertdialog");
    // Dialog title shows the selected NAME, not a raw id.
    expect(within(dialog).getByText(/assign lead to nita shah/i)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: /assign lead/i }));
    await waitFor(() => expect(as.assignLead).toHaveBeenCalledWith("l1", { ownerId: "u7" }));
    expect(await screen.findByText(/assignment submitted/i)).toBeInTheDocument();
  });

  it("accepts a lead through the ConfirmDialog", async () => {
    vi.mocked(as.acceptLead).mockResolvedValue({ accepted: false });
    render(<NextIntlClientProvider locale="en" messages={enMessages}><LeadAssignmentControl leadId="l1" /></NextIntlClientProvider>);
    fireEvent.click(screen.getByRole("button", { name: /^accept lead$/i }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /accept lead/i }));
    await waitFor(() => expect(as.acceptLead).toHaveBeenCalledWith("l1"));
    expect(await screen.findByText(/lead accepted/i)).toBeInTheDocument();
  });

  it("requires a target owner selection for transfer, then transfers using the chosen id", async () => {
    vi.mocked(as.transferOwnership).mockResolvedValue({ accepted: false });
    render(<NextIntlClientProvider locale="en" messages={enMessages}><LeadAssignmentControl leadId="l1" /></NextIntlClientProvider>);
    fireEvent.click(screen.getByRole("button", { name: /transfer lead/i }));
    expect(await screen.findByText(/choose the owner to transfer/i)).toBeInTheDocument();
    expect(as.transferOwnership).not.toHaveBeenCalled();

    const picker = screen.getByLabelText(/owner to transfer this lead to/i);
    fireEvent.change(picker, { target: { value: "Omar" } });
    fireEvent.mouseDown(await screen.findByText("Omar Khan"));
    await screen.findByDisplayValue("Omar Khan");

    fireEvent.click(screen.getByRole("button", { name: /transfer lead/i }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/transfer ownership to omar khan/i)).toBeInTheDocument();
    // Transfer requires a reason for the audit trail (backend contract).
    fireEvent.change(within(dialog).getByLabelText(/reason for transfer/i), { target: { value: "reorg" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /transfer lead/i }));
    await waitFor(() => expect(as.transferOwnership).toHaveBeenCalledWith("l1", "u9", "reorg"));
    expect(await screen.findByText(/ownership transferred to omar khan/i)).toBeInTheDocument();
  });

  it("surfaces the backend error message on failure", async () => {
    vi.mocked(as.acceptLead).mockRejectedValue(new Error("ALREADY_ACCEPTED: nope"));
    render(<NextIntlClientProvider locale="en" messages={enMessages}><LeadAssignmentControl leadId="l1" /></NextIntlClientProvider>);
    fireEvent.click(screen.getByRole("button", { name: /^accept lead$/i }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /accept lead/i }));
    expect((await screen.findAllByText(/already_accepted/i)).length).toBeGreaterThan(0);
  });
});
