import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { PlanItemButton } from "./PlanItemButton";

const PLAN_ID = "11111111-1111-4111-8111-111111111111";
const plansResponse = () =>
  new Response(JSON.stringify({ data: [{ id: PLAN_ID, planNo: "PLAN-FY26-03", title: "Procurement audit" }] }), { status: 200 });

describe("PlanItemButton (GAP-AUDIT-PLAN-01)", () => {
  beforeEach(() => { vi.restoreAllMocks(); refreshMock.mockReset(); });

  async function openAndFill() {
    fireEvent.click(screen.getByRole("button", { name: "+ Add plan item" }));
    await screen.findByRole("option", { name: /PLAN-FY26-03/ });
    fireEvent.change(screen.getByLabelText("Audit plan"), { target: { value: PLAN_ID } });
    fireEvent.change(screen.getByLabelText("Department / unit"), { target: { value: "Procurement Wing" } });
    fireEvent.change(screen.getByLabelText("Scheduled from"), { target: { value: "2026-10-01" } });
    fireEvent.change(screen.getByLabelText("Scheduled to"), { target: { value: "2026-10-31" } });
  }

  it("POSTs deptRef + dates to /plans/:id/items and refreshes", async () => {
    const spy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(plansResponse())
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "x", status: "accepted" }), { status: 202 }));
    render(<PlanItemButton />);
    await openAndFill();
    fireEvent.click(screen.getByRole("button", { name: "Add item" }));
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    const [url, init] = spy.mock.calls[1];
    expect(url).toBe(`/api/proxy/v1/audit/plans/${PLAN_ID}/items`);
    expect((init as RequestInit).method).toBe("POST");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      deptRef: "Procurement Wing", scheduledFrom: "2026-10-01", scheduledTo: "2026-10-31",
    });
  });

  it("shows a guided empty state when no plans exist", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ data: [] }), { status: 200 }));
    render(<PlanItemButton />);
    fireEvent.click(screen.getByRole("button", { name: "+ Add plan item" }));
    expect(await screen.findByText(/No audit plans exist yet/)).toBeInTheDocument();
  });

  it("shows a load error when plans cannot be fetched", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("boom", { status: 500 }));
    render(<PlanItemButton />);
    fireEvent.click(screen.getByRole("button", { name: "+ Add plan item" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load audit plans");
  });

  it("shows a clerk-safe error and does not refresh on a failed save", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(plansResponse())
      .mockResolvedValueOnce(new Response("raw server text", { status: 500 }));
    render(<PlanItemButton />);
    await openAndFill();
    fireEvent.click(screen.getByRole("button", { name: "Add item" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByText(/raw server text/)).not.toBeInTheDocument();
    expect(refreshMock).not.toHaveBeenCalled();
  });
});
