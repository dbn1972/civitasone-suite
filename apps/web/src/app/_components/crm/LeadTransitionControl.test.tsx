import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));

import { LeadTransitionControl } from "./LeadTransitionControl";
import * as lq from "@/lib/crm/leadQualification";

vi.mock("@/lib/crm/leadQualification", async (orig) => {
  const actual = await orig<typeof import("@/lib/crm/leadQualification")>();
  return { ...actual, getReasonCodes: vi.fn(), transitionLead: vi.fn() };
});

const codes: lq.LeadReasonCode[] = [
  { code: "NO_BUDGET", label: "No budget", appliesToStatus: "disqualified", active: true },
  { code: "REVIVED", label: "Opportunity revived", appliesToStatus: "qualified", active: true },
];

beforeEach(() => {
  refresh.mockReset();
  vi.mocked(lq.getReasonCodes).mockReset();
  vi.mocked(lq.transitionLead).mockReset();
});

describe("LeadTransitionControl (LQ-004)", () => {
  it("requires a reason code, then transitions after ConfirmDialog confirmation", async () => {
    vi.mocked(lq.getReasonCodes).mockResolvedValue({ data: codes, source: "api" });
    vi.mocked(lq.transitionLead).mockResolvedValue(undefined);
    render(<LeadTransitionControl leadId="l1" currentStatus="new" />);
    await waitFor(() => expect(screen.getByLabelText(/move to/i)).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText(/move to/i), { target: { value: "disqualified" } });
    // Reason list is filtered to the target status.
    fireEvent.click(screen.getByRole("button", { name: /apply status change/i }));
    expect(await screen.findByText(/choose a reason code/i)).toBeInTheDocument();
    expect(lq.transitionLead).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(/reason code/i), { target: { value: "NO_BUDGET" } });
    fireEvent.change(screen.getByLabelText(/note/i), { target: { value: "budget cut" } });
    fireEvent.click(screen.getByRole("button", { name: /apply status change/i }));

    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /confirm change/i }));
    await waitFor(() =>
      expect(lq.transitionLead).toHaveBeenCalledWith("l1", {
        targetStatus: "disqualified", reasonCode: "NO_BUDGET", reason: "budget cut",
      }),
    );
    expect(refresh).toHaveBeenCalled();
  });

  it("offers a Re-open action for disqualified leads (→ new/qualified)", async () => {
    vi.mocked(lq.getReasonCodes).mockResolvedValue({ data: codes, source: "api" });
    vi.mocked(lq.transitionLead).mockResolvedValue(undefined);
    render(<LeadTransitionControl leadId="l1" currentStatus="disqualified" />);
    await waitFor(() => expect(screen.getByRole("heading", { name: /re-open lead/i })).toBeInTheDocument());
    const select = screen.getByLabelText(/re-open to/i);
    expect(within(select).getByRole("option", { name: "new" })).toBeInTheDocument();
    expect(within(select).getByRole("option", { name: "qualified" })).toBeInTheDocument();

    fireEvent.change(select, { target: { value: "qualified" } });
    fireEvent.change(screen.getByLabelText(/reason code/i), { target: { value: "REVIVED" } });
    fireEvent.click(screen.getByRole("button", { name: /re-open lead/i }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /re-open lead/i }));
    await waitFor(() =>
      expect(lq.transitionLead).toHaveBeenCalledWith("l1", { targetStatus: "qualified", reasonCode: "REVIVED" }),
    );
  });

  it("shows the saved-info badge when reason codes fail to load", async () => {
    vi.mocked(lq.getReasonCodes).mockResolvedValue({ data: [], source: "error" });
    render(<LeadTransitionControl leadId="l1" currentStatus="new" />);
    await waitFor(() => expect(screen.getByText(/showing saved information/i)).toBeInTheDocument());
  });
});
