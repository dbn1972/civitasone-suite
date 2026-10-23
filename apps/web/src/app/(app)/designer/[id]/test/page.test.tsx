import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "def-1" }),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("../../_data/useDesignerWizard", () => ({
  useDesignerWizard: () => ({
    loading: false,
    error: null,
    def: { id: "def-1" },
    meta: { name: "Svc", patternLabel: "P", version: 1, status: "draft" },
    saveState: "idle",
    blocks: [],
    prev: "b8",
    canRunTest: true,
    canSubmit: false,
    submitting: false,
    reload: vi.fn(async () => {}),
    onSubmit: vi.fn(async () => {}),
  }),
}));

const runSandboxTest = vi.fn();
const fetchSandboxTestHistory = vi.fn();
vi.mock("../../_data/sandboxTestApi", () => ({
  runSandboxTest: (...a: unknown[]) => runSandboxTest(...a),
  fetchSandboxTestHistory: (...a: unknown[]) => fetchSandboxTestHistory(...a),
}));

vi.mock("@/app/_components/ds/designer", () => ({
  WizardShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TestRunPanel: ({ steps, onRun }: { steps: Array<{ id: string; label: string; status: string; error?: string }>; onRun?: () => void }) => (
    <div>
      <button type="button" onClick={onRun}>run test</button>
      <ul>{steps.map((s) => <li key={s.id}>{`${s.label}:${s.status}`}</li>)}</ul>
    </div>
  ),
}));

import DesignerTestPage from "./page";

describe("DesignerTestPage — CLOS2-S1-09 history load failure", () => {
  const unhandled: unknown[] = [];
  const onUnhandled = (e: PromiseRejectionEvent) => { unhandled.push(e.reason); e.preventDefault?.(); };
  const nodeUnhandled = (r: unknown) => { unhandled.push(r); };

  beforeEach(() => {
    unhandled.length = 0;
    runSandboxTest.mockReset();
    fetchSandboxTestHistory.mockReset();
    window.addEventListener("unhandledrejection", onUnhandled);
    process.on("unhandledRejection", nodeUnhandled);
  });
  afterEach(() => {
    window.removeEventListener("unhandledrejection", onUnhandled);
    process.off("unhandledRejection", nodeUnhandled);
  });

  it("does not leave an unhandled rejection when the mount-time history fetch fails", async () => {
    fetchSandboxTestHistory.mockRejectedValue(new TypeError("Failed to fetch"));
    render(<DesignerTestPage />);
    await waitFor(() => expect(fetchSandboxTestHistory).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 50));
    expect(unhandled).toEqual([]);
  });

  it("keeps a successful run's steps when only the follow-up history refresh fails", async () => {
    fetchSandboxTestHistory.mockResolvedValueOnce([]).mockRejectedValue(new TypeError("Failed to fetch"));
    runSandboxTest.mockResolvedValue({ id: "r1", status: "pass", steps: [{ id: "only", label: "Good step", status: "pass" }] });
    render(<DesignerTestPage />);
    await waitFor(() => expect(fetchSandboxTestHistory).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "run test" }));
    await waitFor(() => expect(fetchSandboxTestHistory).toHaveBeenCalledTimes(2));
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByText("Good step:pass")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("fail");
    expect(unhandled).toEqual([]);
  });
});
