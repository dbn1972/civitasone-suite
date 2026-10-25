import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ChecklistWithActions } from "./ChecklistWithActions";
import type { ChecklistStep } from "./OnboardingChecklist";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock, push: vi.fn() }),
}));

const STEPS: ChecklistStep[] = [
  { id: "task-1", label: "Submit joining report", status: "pending", dueDay: 1 },
  { id: "task-2", label: "Collect ID badge", status: "overdue", dueDay: 3 },
];

describe("ChecklistWithActions", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("GAP-HR-ONBOARDING-DETAIL-01: renders a 'Mark done' button for a pending step -- previously never rendered because no onComplete was ever wired", () => {
    render(<ChecklistWithActions steps={STEPS} />);
    expect(screen.getByRole("button", { name: /mark "submit joining report" as complete/i })).toBeInTheDocument();
  });

  it("marks a step completed optimistically and calls the real complete endpoint", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({ ok: true } as Response);
    render(<ChecklistWithActions steps={STEPS} />);

    fireEvent.click(screen.getByRole("button", { name: /mark "submit joining report" as complete/i }));

    // Optimistic: the button for that step disappears immediately (OnboardingChecklist
    // only renders it while status !== "completed").
    expect(screen.queryByRole("button", { name: /mark "submit joining report" as complete/i })).not.toBeInTheDocument();
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/proxy/v1/hrms/onboarding-tasks/task-1/complete",
      expect.objectContaining({ method: "PATCH" }),
    );
  });

  it("rolls the step back and shows a clerk-safe error when the API call fails", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({ ok: false, status: 500, clone: () => ({ json: async () => ({}) }) } as unknown as Response);
    render(<ChecklistWithActions steps={STEPS} />);

    fireEvent.click(screen.getByRole("button", { name: /mark "submit joining report" as complete/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/couldn't save/i);
    expect(alert).not.toHaveTextContent(/500/);
    // Rolled back: the button reappears since the step is pending again.
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /mark "submit joining report" as complete/i })).toBeInTheDocument();
    });
  });

  it("does not touch the other step's own pending 'Mark done' button when one step is completed", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({ ok: true } as Response);
    render(<ChecklistWithActions steps={STEPS} />);

    fireEvent.click(screen.getByRole("button", { name: /mark "submit joining report" as complete/i }));

    expect(screen.getByRole("button", { name: /mark "collect id badge" as complete/i })).toBeInTheDocument();
  });

  describe("CLOS3-S2-01: rollback reverts only the failed step", () => {
    function deferred() {
      let resolve!: (v: Response) => void;
      let reject!: (e: unknown) => void;
      const promise = new Promise<Response>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      return { promise, resolve, reject };
    }
    const failed500 = { ok: false, status: 500, clone: () => ({ json: async () => ({}) }) } as unknown as Response;

    it("a failure on one step does not undo a concurrent successful completion of another", async () => {
      const a = deferred();
      const b = deferred();
      global.fetch = vi.fn((url: RequestInfo | URL) =>
        String(url).includes("/task-1/") ? a.promise : b.promise,
      ) as unknown as typeof fetch;
      render(<ChecklistWithActions steps={STEPS} />);

      fireEvent.click(screen.getByRole("button", { name: /mark "submit joining report" as complete/i }));
      fireEvent.click(screen.getByRole("button", { name: /mark "collect id badge" as complete/i }));

      b.resolve({ ok: true } as Response);
      a.resolve(failed500);

      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent(/couldn't save/i);
      // A reverted to its own prior status (pending) -> button is back.
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /mark "submit joining report" as complete/i })).toBeInTheDocument();
      });
      // B stays completed -> its button must not come back.
      expect(screen.queryByRole("button", { name: /mark "collect id badge" as complete/i })).not.toBeInTheDocument();
    });

    it("when both calls reject, each step returns to its own prior status", async () => {
      const a = deferred();
      const b = deferred();
      global.fetch = vi.fn((url: RequestInfo | URL) =>
        String(url).includes("/task-1/") ? a.promise : b.promise,
      ) as unknown as typeof fetch;
      render(<ChecklistWithActions steps={STEPS} />);

      fireEvent.click(screen.getByRole("button", { name: /mark "submit joining report" as complete/i }));
      fireEvent.click(screen.getByRole("button", { name: /mark "collect id badge" as complete/i }));

      a.reject(new Error("network"));
      b.reject(new Error("network"));

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /mark "submit joining report" as complete/i })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: /mark "collect id badge" as complete/i })).toBeInTheDocument();
      });
      // No stale completed state: neither step is counted as done.
      expect(screen.getByText(/0 \/ 2 steps completed/)).toBeInTheDocument();
    });
  });
});
