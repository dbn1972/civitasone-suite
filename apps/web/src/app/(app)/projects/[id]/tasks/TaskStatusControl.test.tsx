import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: refreshMock }) }));

import { TaskStatusControl, allowedNextStatuses } from "./TaskStatusControl";

describe("GAP-PROJECTS-DETAIL-TASKS-01 TaskStatusControl", () => {
  beforeEach(() => {
    refreshMock.mockReset();
    vi.restoreAllMocks();
  });

  it("offers only the legal next statuses (mirrors the service transition table)", () => {
    expect(allowedNextStatuses("pending")).toEqual(["in_progress", "blocked"]);
    expect(allowedNextStatuses("completed")).toEqual([]);
    render(<TaskStatusControl projectId="p1" taskId="t1" status="pending" progressPct={0} />);
    const opts = screen.getAllByRole("option").map((o) => o.textContent);
    expect(opts).toEqual(["Pending (current)", "In Progress", "Blocked"]);
  });

  it("a completed task is terminal: no controls", () => {
    render(<TaskStatusControl projectId="p1" taskId="t1" status="completed" progressPct={100} />);
    expect(screen.queryByRole("button", { name: "Update" })).not.toBeInTheDocument();
  });

  it("PATCHes status and progress to the proxy endpoint and refreshes", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "t1", status: "accepted" }), { status: 202 }),
    );
    render(<TaskStatusControl projectId="p1" taskId="t1" status="pending" progressPct={0} />);
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "in_progress" } });
    fireEvent.change(screen.getByLabelText("Progress %"), { target: { value: "40" } });
    fireEvent.click(screen.getByRole("button", { name: "Update" }));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe("/api/proxy/v1/projects/p1/tasks/t1/status");
    expect((init as RequestInit).method).toBe("PATCH");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ status: "in_progress", progressPct: 40 });
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });

  it("rejects out-of-range progress client-side without calling the API", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    render(<TaskStatusControl projectId="p1" taskId="t1" status="pending" progressPct={0} />);
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "in_progress" } });
    fireEvent.change(screen.getByLabelText("Progress %"), { target: { value: "140" } });
    fireEvent.click(screen.getByRole("button", { name: "Update" }));
    expect(await screen.findByText("Progress must be between 0 and 100.")).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("a server refusal is shown as a human message (not raw), and the page refreshes on 422", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ code: "INVALID_TRANSITION", message: "task cannot transition" }), { status: 422 }),
    );
    render(<TaskStatusControl projectId="p1" taskId="t1" status="pending" progressPct={0} />);
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "blocked" } });
    fireEvent.click(screen.getByRole("button", { name: "Update" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).not.toMatch(/INVALID_TRANSITION/);
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });
});
