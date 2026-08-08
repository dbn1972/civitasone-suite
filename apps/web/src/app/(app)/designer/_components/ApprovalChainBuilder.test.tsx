import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
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

describe("ApprovalChainBuilder B4 round-trip UX", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("opens advanced editor with custom-mode banner and revert affordance", async () => {
    render(
      <ApprovalChainBuilder serviceName="Trade Licence" initial={emptyWorkflowDesign("Trade Licence")} />,
    );

    fireEvent.click(screen.getByRole("button", { name: /open visual editor \(advanced\)/i }));
    expect(await screen.findByText(/custom-workflow mode/i)).toBeInTheDocument();
    expect(screen.getByTestId("mock-bpmn-canvas")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /revert to template/i })).toBeInTheDocument();
  });

  it("locks guided controls in custom mode and shows revert + diff confirm", async () => {
    const initial = emptyWorkflowDesign("Trade Licence");
    render(<ApprovalChainBuilder serviceName="Trade Licence" initial={initial} />);

    fireEvent.click(screen.getByRole("button", { name: /open visual editor \(advanced\)/i }));
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
