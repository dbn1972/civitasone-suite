import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: refreshMock }) }));

import { AddTaskForm } from "./AddTaskForm";

describe("GAP-PROJECTS-DETAIL-TASKS-01 AddTaskForm", () => {
  beforeEach(() => {
    refreshMock.mockReset();
    vi.restoreAllMocks();
  });

  it("POSTs the task to the proxy endpoint and refreshes on success", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "t1", status: "accepted" }), { status: 202 }),
    );
    render(<AddTaskForm projectId="p1" />);
    fireEvent.change(screen.getByLabelText("Task name"), { target: { value: "Foundation" } });
    fireEvent.change(screen.getByLabelText("Weight %"), { target: { value: "25" } });
    fireEvent.click(screen.getByText("Add task"));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe("/api/proxy/v1/projects/p1/tasks");
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({ name: "Foundation", weightPct: 25 });
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });

  it("blocks submit and shows an error when the name is empty (client zod guard)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    render(<AddTaskForm projectId="p1" />);
    fireEvent.click(screen.getByText("Add task"));
    expect(await screen.findByText("Task name is required")).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
