import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: refreshMock }) }));

import { AllocationDecisionButtons } from "./AllocationDecisionButtons";

const wrap = (ui: React.ReactElement) => render(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);

describe("AllocationDecisionButtons (maker-checker)", () => {
  beforeEach(() => { vi.restoreAllMocks(); refreshMock.mockReset(); });

  it("shows no buttons to the person who requested the allocation", () => {
    wrap(<AllocationDecisionButtons allocationId="a1" requestedBy="u1" currentUserId="u1" label="Asha 60%" />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText("Waiting for another approver")).toBeInTheDocument();
  });

  it("names the allocation in each button for screen readers, confirms, then POSTs the decision", async () => {
    const f = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ id: "a1", status: "accepted" }), { status: 202 }));
    wrap(<AllocationDecisionButtons allocationId="a1" requestedBy="u1" currentUserId="u2" label="Asha 60%" />);
    fireEvent.click(screen.getByRole("button", { name: "Approve allocation: Asha 60%" }));
    expect(f).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: "Approve" }));
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    const [url, init] = f.mock.calls[0]!;
    expect(String(url)).toContain("project-costing/allocations/a1/decision");
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ decision: "approve" });
  });

  it("shows the server's self-approval refusal", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ code: "SELF_APPROVAL", message: "no" }), { status: 403 }));
    wrap(<AllocationDecisionButtons allocationId="a1" requestedBy="u1" currentUserId={null} label="Asha 60%" />);
    fireEvent.click(screen.getByRole("button", { name: "Reject allocation: Asha 60%" }));
    fireEvent.click(await screen.findByRole("button", { name: "Reject" }));
    expect(await screen.findAllByText("You cannot approve an allocation you requested.")).not.toHaveLength(0);
  });
});
