import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AddTaskForm } from "./AddTaskForm";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock, push: vi.fn() }),
}));

describe("AddTaskForm", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("GAP-HR-ONBOARDING-02: posts a new task to the existing per-employee endpoint", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({ ok: true } as Response);
    render(<AddTaskForm employeeId="emp-1" />);

    fireEvent.change(screen.getByLabelText("Task title"), { target: { value: "Collect ID badge" } });
    fireEvent.change(screen.getByLabelText("Due (days from joining)"), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "Add task" }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/proxy/v1/hrms/employees/emp-1/onboarding-tasks",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ title: "Collect ID badge", dueByDay: 5 }),
      }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent("Task added.");
  });

  it("disables submit until a title is entered", () => {
    render(<AddTaskForm employeeId="emp-1" />);
    expect(screen.getByRole("button", { name: "Add task" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Task title"), { target: { value: "Something" } });
    expect(screen.getByRole("button", { name: "Add task" })).toBeEnabled();
  });

  it("shows a clerk-safe error and does not clear the form on failure", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({ ok: false, status: 500, clone: () => ({ json: async () => ({}) }) } as unknown as Response);
    render(<AddTaskForm employeeId="emp-1" />);

    fireEvent.change(screen.getByLabelText("Task title"), { target: { value: "Collect ID badge" } });
    fireEvent.click(screen.getByRole("button", { name: "Add task" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/couldn't save/i);
    expect(alert).not.toHaveTextContent(/500/);
    expect(screen.getByLabelText("Task title")).toHaveValue("Collect ID badge");
  });
});
