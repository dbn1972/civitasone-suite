import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ToastProvider } from "@/app/_components/ds";
import { TaskActions } from "./TaskActions";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: refreshMock }) }));

const ME = "11111111-1111-1111-1111-111111111111";

describe("TaskActions global toast — GAP-WORKFLOW-INSTANCES-DETAIL-04", () => {
  beforeEach(() => { refreshMock.mockReset(); vi.restoreAllMocks(); });
  afterEach(() => vi.restoreAllMocks());

  it("announces the outcome via the global ToastProvider (survives the row refresh)", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(null, { status: 202 }) as unknown as Response,
    );
    render(
      <ToastProvider>
        <TaskActions taskId="t1" status="pending" assigneeId={null} currentUserId={ME} compact />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: /Claim/ }));
    await waitFor(() => expect(screen.getByText("Task claimed.")).toBeInTheDocument());
    // The toast lives above the table (its own alert region), not inside the row.
    expect(screen.getByText("Task claimed.").closest('[role="alert"]')).not.toBeNull();
  });
});
