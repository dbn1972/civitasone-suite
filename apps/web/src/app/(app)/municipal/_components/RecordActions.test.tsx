import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: refreshMock }) }));

const browserFetchMock = vi.fn();
vi.mock("@/lib/api/browserClient", () => ({
  browserFetch: (...args: unknown[]) => browserFetchMock(...args),
}));

import { RecordActions } from "./RecordActions";
import type { MunicipalWorkflowConfig } from "../_data/services";

const workflow: MunicipalWorkflowConfig = {
  historyBasePath: "/api/v1/trade/applications",
  decisionPath: "/api/v1/trade/approvals/decide",
  scrutinyPath: "/api/v1/trade/approvals/scrutiny",
  officerRoles: ["trade_admin"],
  decidableStatuses: ["under_scrutiny"],
  inspectableStatuses: ["submitted"],
};

describe("RecordActions (GAP-MUNICIPAL-SERVICEKEY-APPLICATIONS-DETAIL-02)", () => {
  beforeEach(() => {
    refreshMock.mockReset();
    browserFetchMock.mockReset();
    browserFetchMock.mockResolvedValue(new Response(JSON.stringify({ id: "x" }), { status: 202 }));
  });

  it("offers Start inspection from an inspectable status and POSTs to the scrutiny path", async () => {
    render(<RecordActions applicationId="app-1" status="submitted" workflow={workflow} />);
    // Not decidable from 'submitted' → no Approve/Reject.
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Start inspection" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm — start inspection" }));
    await waitFor(() => expect(browserFetchMock).toHaveBeenCalledTimes(1));
    expect(browserFetchMock.mock.calls[0][0]).toBe("/api/v1/trade/approvals/scrutiny");
    const body = JSON.parse((browserFetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body).toMatchObject({ applicationId: "app-1", scrutinyType: "field_inspection" });
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });

  it("offers Approve/Reject from a decidable status and POSTs the decision with a reason", async () => {
    render(<RecordActions applicationId="app-2" status="under_scrutiny" workflow={workflow} />);
    expect(screen.queryByRole("button", { name: "Start inspection" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "missing NOC" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm reject" }));
    await waitFor(() => expect(browserFetchMock).toHaveBeenCalledTimes(1));
    expect(browserFetchMock.mock.calls[0][0]).toBe("/api/v1/trade/approvals/decide");
    const body = JSON.parse((browserFetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body).toMatchObject({ applicationId: "app-2", decision: "rejected", reason: "missing NOC" });
  });

  it("shows an honest 'no actions available' when the status allows neither", () => {
    render(<RecordActions applicationId="app-3" status="approved" workflow={workflow} />);
    expect(screen.getByText(/No actions are available/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
  });

  it("surfaces a server error without refreshing when the action fails", async () => {
    browserFetchMock.mockResolvedValue(new Response("nope", { status: 403 }));
    render(<RecordActions applicationId="app-4" status="under_scrutiny" workflow={workflow} />);
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm approve" }));
    await waitFor(() => expect(screen.getByText(/could not be completed/)).toBeInTheDocument());
    expect(refreshMock).not.toHaveBeenCalled();
  });
});
