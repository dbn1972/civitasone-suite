import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));

import { LeadAssignmentControl } from "./LeadAssignmentControl";
import * as as from "@/lib/crm/assignment";

vi.mock("@/lib/crm/assignment", async (orig) => {
  const actual = await orig<typeof import("@/lib/crm/assignment")>();
  return { ...actual, assignLead: vi.fn(), acceptLead: vi.fn(), transferOwnership: vi.fn() };
});

beforeEach(() => {
  refresh.mockReset();
  vi.mocked(as.assignLead).mockReset();
  vi.mocked(as.acceptLead).mockReset();
  vi.mocked(as.transferOwnership).mockReset();
});

describe("LeadAssignmentControl (AS-001/002/004)", () => {
  it("runs the rule chain via ConfirmDialog (sync wording on 200)", async () => {
    vi.mocked(as.assignLead).mockResolvedValue({ accepted: false });
    render(<LeadAssignmentControl leadId="l1" />);
    fireEvent.click(screen.getByRole("button", { name: /run assignment rules/i }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /assign lead/i }));
    await waitFor(() => expect(as.assignLead).toHaveBeenCalledWith("l1", { runRules: true }));
    expect(await screen.findByText(/assigned by the rule chain/i)).toBeInTheDocument();
    expect(refresh).toHaveBeenCalled();
  });

  it("requires an owner id for specific-owner assign, then sends ownerId", async () => {
    vi.mocked(as.assignLead).mockResolvedValue({ accepted: true });
    render(<LeadAssignmentControl leadId="l1" />);
    fireEvent.click(screen.getByRole("tab", { name: /specific owner/i }));
    fireEvent.click(screen.getByRole("button", { name: /assign to owner/i }));
    expect(await screen.findByText(/enter the owner id to assign/i)).toBeInTheDocument();
    expect(as.assignLead).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(/^owner id$/i), { target: { value: "u7" } });
    fireEvent.click(screen.getByRole("button", { name: /assign to owner/i }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /assign lead/i }));
    await waitFor(() => expect(as.assignLead).toHaveBeenCalledWith("l1", { ownerId: "u7" }));
    // 202 → async wording, not the concrete "assigned to".
    expect(await screen.findByText(/assignment submitted/i)).toBeInTheDocument();
  });

  it("accepts a lead through the ConfirmDialog", async () => {
    vi.mocked(as.acceptLead).mockResolvedValue({ accepted: false });
    render(<LeadAssignmentControl leadId="l1" />);
    fireEvent.click(screen.getByRole("button", { name: /^accept lead$/i }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /accept lead/i }));
    await waitFor(() => expect(as.acceptLead).toHaveBeenCalledWith("l1"));
    expect(await screen.findByText(/lead accepted/i)).toBeInTheDocument();
  });

  it("requires a target owner for transfer, then transfers", async () => {
    vi.mocked(as.transferOwnership).mockResolvedValue({ accepted: false });
    render(<LeadAssignmentControl leadId="l1" />);
    fireEvent.click(screen.getByRole("button", { name: /transfer lead/i }));
    expect(await screen.findByText(/enter the owner id to transfer/i)).toBeInTheDocument();
    expect(as.transferOwnership).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(/transfer to owner id/i), { target: { value: "u9" } });
    fireEvent.click(screen.getByRole("button", { name: /transfer lead/i }));
    const dialog = await screen.findByRole("alertdialog");
    // Transfer requires a reason for the audit trail (backend contract).
    fireEvent.change(within(dialog).getByLabelText(/reason for transfer/i), { target: { value: "reorg" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /transfer lead/i }));
    await waitFor(() => expect(as.transferOwnership).toHaveBeenCalledWith("l1", "u9", "reorg"));
    expect(await screen.findByText(/ownership transferred to u9/i)).toBeInTheDocument();
  });

  it("surfaces the backend error message on failure", async () => {
    vi.mocked(as.acceptLead).mockRejectedValue(new Error("ALREADY_ACCEPTED: nope"));
    render(<LeadAssignmentControl leadId="l1" />);
    fireEvent.click(screen.getByRole("button", { name: /^accept lead$/i }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /accept lead/i }));
    expect((await screen.findAllByText(/already_accepted/i)).length).toBeGreaterThan(0);
  });
});
