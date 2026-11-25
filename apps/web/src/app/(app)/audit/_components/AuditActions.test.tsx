import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { PlanActions } from "../plan/PlanActions";
import { RiskActions } from "../risk-register/RiskActions";
import { InvestigationActions } from "../investigation/InvestigationActions";

const ID = "11111111-1111-4111-8111-111111111111";
const ok = () => new Response(JSON.stringify({ id: ID, status: "accepted" }), { status: 202 });

beforeEach(() => { vi.restoreAllMocks(); refreshMock.mockReset(); });

describe("PlanActions (GAP-AUDIT-PLAN-05)", () => {
  it("offers Defer + Complete for an in-progress plan, only Defer for planned, nothing when completed", () => {
    const { unmount } = render(<PlanActions planId={ID} status="in_progress" />);
    expect(screen.getByRole("button", { name: "Complete" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Defer" })).toBeInTheDocument();
    unmount();
    const r2 = render(<PlanActions planId={ID} status="planned" />);
    expect(screen.queryByRole("button", { name: "Complete" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Defer" })).toBeInTheDocument();
    r2.unmount();
    render(<PlanActions planId={ID} status="completed" />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("requires a defer reason, then PATCHes /defer with it", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(ok());
    render(<PlanActions planId={ID} planNo="PLAN-1" status="in_progress" />);
    fireEvent.click(screen.getByRole("button", { name: "Defer" }));
    fireEvent.click(screen.getByRole("button", { name: "Defer plan" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Defer reason is required");
    expect(spy).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Defer reason"), { target: { value: "Budget freeze" } });
    fireEvent.click(screen.getByRole("button", { name: "Defer plan" }));
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    const [url, init] = spy.mock.calls[0];
    expect(url).toBe(`/api/proxy/v1/audit/plans/${ID}/defer`);
    expect((init as RequestInit).method).toBe("PATCH");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ reason: "Budget freeze" });
  });

  it("completes with no reason", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(ok());
    render(<PlanActions planId={ID} status="in_progress" />);
    fireEvent.click(screen.getByRole("button", { name: "Complete" }));
    fireEvent.click(screen.getByRole("button", { name: "Complete plan" }));
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    expect(spy.mock.calls[0][0]).toBe(`/api/proxy/v1/audit/plans/${ID}/complete`);
  });

  it("shows the server message and does not refresh on a 409", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ code: "INVALID_STATUS", message: "x" }), { status: 409 }));
    render(<PlanActions planId={ID} status="in_progress" />);
    fireEvent.click(screen.getByRole("button", { name: "Complete" }));
    fireEvent.click(screen.getByRole("button", { name: "Complete plan" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(refreshMock).not.toHaveBeenCalled();
  });
});

describe("RiskActions (GAP-AUDIT-RISK-REGISTER-04)", () => {
  it("hides Close for an already closed risk", () => {
    render(<RiskActions riskId={ID} riskCode="R-1" status="closed" />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("will not close without a reason, then PATCHes status closed + closeReason", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(ok());
    render(<RiskActions riskId={ID} riskCode="R-1" status="open" />);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(screen.getByRole("button", { name: "Close risk" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Close reason is required");
    expect(spy).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Close reason"), { target: { value: "Mitigations verified" } });
    fireEvent.click(screen.getByRole("button", { name: "Close risk" }));
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    const [url, init] = spy.mock.calls[0];
    expect(url).toBe(`/api/proxy/v1/audit/risks/${ID}`);
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ status: "closed", closeReason: "Mitigations verified" });
  });
});

describe("InvestigationActions (GAP-AUDIT-INVESTIGATION-05)", () => {
  it("renders nothing for a closed case", () => {
    const { container } = render(<InvestigationActions id={ID} caseId="C-1" status="closed" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("assigns an officer", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(ok());
    render(<InvestigationActions id={ID} caseId="C-1" status="in_progress" />);
    fireEvent.click(screen.getByRole("button", { name: "Assign" }));
    fireEvent.change(screen.getByLabelText("Assign to (officer)"), { target: { value: " officer:two " } });
    fireEvent.click(screen.getAllByRole("button", { name: "Assign" }).at(-1)!);
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    const [url, init] = spy.mock.calls[0];
    expect(url).toBe(`/api/proxy/v1/audit/investigations/${ID}/assign`);
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ assignedTo: "officer:two" });
  });

  it("closes only with an outcome and a reason", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(ok());
    render(<InvestigationActions id={ID} caseId="C-1" status="findings_submitted" />);
    fireEvent.click(screen.getByRole("button", { name: "Close case" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Close case" }).at(-1)!);
    expect(await screen.findByRole("alert")).toHaveTextContent("Outcome is required");
    fireEvent.change(screen.getByLabelText("Outcome"), { target: { value: "inconclusive" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Close case" }).at(-1)!);
    expect(await screen.findByRole("alert")).toHaveTextContent("Close reason is required");
    fireEvent.change(screen.getByLabelText("Close reason"), { target: { value: "No corroborating evidence" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Close case" }).at(-1)!);
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    const [url, init] = spy.mock.calls[0];
    expect(url).toBe(`/api/proxy/v1/audit/investigations/${ID}/close`);
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ outcome: "inconclusive", reason: "No corroborating evidence" });
  });
});
