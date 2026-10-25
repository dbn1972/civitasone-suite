import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { emptyWorkflowDesign } from "../_data/workflowConstants";

vi.mock("../_data/workflowBuilderApi", () => ({
  fetchTenantPositions: vi.fn(async () => [
    { id: "pos-1", label: "Licensing Officer" },
    { id: "pos-2", label: "Licensing Inspector" },
  ]),
  persistWorkflowDesign: vi.fn(async (d: unknown) => d),
}));

vi.mock("next/dynamic", () => ({
  default: () => {
    function MockCanvas() {
      return <div data-testid="mock-bpmn-canvas">Seeded visual editor</div>;
    }
    return MockCanvas;
  },
}));

vi.mock("@/app/_components/ds", () => ({
  Card: ({ children }: { children?: ReactNode }) => <div data-testid="card">{children}</div>,
  Button: ({ children, onClick }: { children?: ReactNode; onClick?: () => void }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
  ConfirmDialog: ({
    open,
    title,
    description,
    confirmLabel = "Confirm",
    cancelLabel = "Cancel",
    onConfirm,
    onCancel,
  }: {
    open: boolean;
    title: string;
    description?: ReactNode;
    confirmLabel?: string;
    cancelLabel?: string;
    onConfirm: () => void;
    onCancel: () => void;
  }) =>
    open ? (
      <div role="alertdialog" aria-label={title}>
        <h2>{title}</h2>
        <div>{description}</div>
        <button type="button" onClick={onCancel}>{cancelLabel}</button>
        <button type="button" onClick={onConfirm}>{confirmLabel}</button>
      </div>
    ) : null,
}));

import { ApprovalChainBuilder } from "./ApprovalChainBuilder";
import { persistWorkflowDesign } from "../_data/workflowBuilderApi";
import type { WorkflowDesignState } from "../_data/workflowConstants";

describe("ApprovalChainBuilder B4 round-trip UX", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("opens advanced editor with custom-mode banner and revert affordance", async () => {
    render(
      <ApprovalChainBuilder serviceName="Trade Licence" initial={emptyWorkflowDesign("Trade Licence")} />,
    );

    fireEvent.click(screen.getByRole("button", { name: /open visual editor \(advanced\)/i }));
    // GAP-DESIGNER-DETAIL-B4-03: a confirm dialog now precedes entering advanced mode.
    const confirmDialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(confirmDialog).getByRole("button", { name: /open visual editor/i }));
    expect(await screen.findByText(/custom-workflow mode/i)).toBeInTheDocument();
    expect(screen.getByTestId("mock-bpmn-canvas")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /revert to template/i })).toBeInTheDocument();
  });

  it("locks guided controls in custom mode and shows revert + diff confirm", async () => {
    const initial = emptyWorkflowDesign("Trade Licence");
    render(<ApprovalChainBuilder serviceName="Trade Licence" initial={initial} />);

    fireEvent.click(screen.getByRole("button", { name: /open visual editor \(advanced\)/i }));
    // Click through the B4-03 confirm dialog.
    const advConfirm = await screen.findByRole("alertdialog");
    fireEvent.click(within(advConfirm).getByRole("button", { name: /open visual editor/i }));
    fireEvent.click(screen.getByRole("button", { name: /back to guided chain/i }));

    expect(await screen.findByText(/uses a custom workflow/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /revert to template/i })).toBeInTheDocument();

    const selects = screen.getAllByRole("combobox");
    expect(selects.length).toBeGreaterThan(0);
    expect(selects.every((el) => (el as HTMLSelectElement).disabled)).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: /revert to template/i }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/workflow mode/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/^Custom visual editor$/)).toBeInTheDocument();
    expect(within(dialog).getByText(/^Guided approval chain$/)).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/changes on revert/i)).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: /revert to template/i }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(screen.queryByText(/uses a custom workflow/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /open visual editor \(advanced\)/i })).toBeInTheDocument();
  });
});

describe("ApprovalChainBuilder B4-02 per-lane escalation warning", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows an inline warning in the LaneCard when SLA is set but escalation designation is empty", async () => {
    const initial = emptyWorkflowDesign("Trade Licence");
    // Set a non-zero SLA on the inspection lane (slaDays=5) with no escalation designation;
    // all other lanes also get an escalation designation to isolate the assertion.
    const withSla = {
      ...initial,
      lanes: initial.lanes.map((l) =>
        l.key === "inspection"
          ? { ...l, enabled: true, designationId: "pos-1", slaDays: 5, escalationDesignationId: "" }
          : { ...l, escalationDesignationId: "pos-9", escalationDesignationLabel: "Superior" },
      ),
    };
    render(<ApprovalChainBuilder serviceName="Trade Licence" initial={withSla} />);

    // Multiple Escalation designation selects exist, one per action lane.
    await screen.findAllByLabelText("Escalation designation");

    // GAP-DESIGNER-DETAIL-B4-02: the per-lane inline warning should appear
    // under the escalation select of the Inspection LaneCard.
    const warnings = screen.getAllByText(/SLA is 5 day/i);
    expect(warnings.length).toBeGreaterThanOrEqual(1);
    expect(warnings[0]).toBeInTheDocument();
  });

  it("clears the inline escalation warning when both SLA and escalation designation are set", async () => {
    const initial = emptyWorkflowDesign("Trade Licence");
    // Set escalation designation on ALL action lanes so none produce a warning.
    const withBoth = {
      ...initial,
      lanes: initial.lanes.map((l) => ({
        ...l,
        designationId: "pos-1",
        designationLabel: "Licensing Officer",
        escalationDesignationId: "pos-2",
        escalationDesignationLabel: "Superior",
      })),
    };
    render(<ApprovalChainBuilder serviceName="Trade Licence" initial={withBoth} />);

    // Wait for escalation selects to render.
    await screen.findAllByLabelText("Escalation designation");

    // GAP-DESIGNER-DETAIL-B4-02: no missing_escalation warning should appear
    // when all lanes have an escalation designation set.
    expect(screen.queryByText(/but no escalation designation is set/i)).not.toBeInTheDocument();
  });
});

// CLOS3-S1-02: persistWorkflowDesign returns a NEW object (version+1) every call; feeding it back via
// setDesign re-armed the autosave effect forever (PATCH every 2s, version climbing with no edits).
describe("ApprovalChainBuilder CLOS3-S1-02 autosave settles", () => {
  const advance = async (times: number) => {
    for (let i = 0; i < times; i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2100);
      });
    }
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.mocked(persistWorkflowDesign).mockImplementation(async (d: WorkflowDesignState) => ({ ...d, version: d.version + 1 }));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not keep re-saving an unedited draft", async () => {
    const seen: number[] = [];
    render(
      <ApprovalChainBuilder
        serviceName="T"
        initial={{ ...emptyWorkflowDesign("T"), definitionId: "d1", version: 1 }}
        onDesignPersisted={(d) => { seen.push(d.version); }}
      />,
    );
    await advance(5);
    expect(vi.mocked(persistWorkflowDesign).mock.calls.length).toBeLessThanOrEqual(1);
    expect(seen.length).toBeLessThanOrEqual(1);
    if (seen.length === 1) expect(seen[0]).toBe(2);
  });

  it("saves exactly once more after a lane edit", async () => {
    render(
      <ApprovalChainBuilder
        serviceName="T"
        initial={{ ...emptyWorkflowDesign("T"), definitionId: "d1", version: 1 }}
      />,
    );
    await advance(5);
    const before = vi.mocked(persistWorkflowDesign).mock.calls.length;
    const input = screen.getAllByLabelText("Step name")[0] as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Edited step" } });
    await advance(5);
    expect(vi.mocked(persistWorkflowDesign).mock.calls.length).toBe(before + 1);
  });
});
