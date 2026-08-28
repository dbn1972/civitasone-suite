import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ConfirmDialog } from "./ConfirmDialog";

describe("ConfirmDialog", () => {
  const baseProps = {
    open: true,
    title: "Delete record?",
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
  };

  it("renders nothing when open is false", () => {
    const { container } = render(<ConfirmDialog {...baseProps} open={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders title when open", () => {
    render(<ConfirmDialog {...baseProps} />);
    expect(screen.getByText("Delete record?")).toBeInTheDocument();
  });

  it("renders description when provided", () => {
    render(<ConfirmDialog {...baseProps} description="This cannot be undone." />);
    expect(screen.getByText("This cannot be undone.")).toBeInTheDocument();
  });

  it("uses role=alertdialog with aria-modal", () => {
    render(<ConfirmDialog {...baseProps} />);
    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
  });

  it("renders default button labels", () => {
    render(<ConfirmDialog {...baseProps} />);
    expect(screen.getByText("Confirm")).toBeInTheDocument();
    expect(screen.getByText("Cancel")).toBeInTheDocument();
  });

  it("renders custom button labels", () => {
    render(<ConfirmDialog {...baseProps} confirmLabel="Delete" cancelLabel="Keep" />);
    expect(screen.getByText("Delete")).toBeInTheDocument();
    expect(screen.getByText("Keep")).toBeInTheDocument();
  });

  it("calls onConfirm when confirm button clicked", () => {
    const onConfirm = vi.fn();
    render(<ConfirmDialog {...baseProps} onConfirm={onConfirm} />);
    fireEvent.click(screen.getByText("Confirm"));
    expect(onConfirm).toHaveBeenCalledWith(undefined);
  });

  it("calls onCancel when cancel button clicked", () => {
    const onCancel = vi.fn();
    render(<ConfirmDialog {...baseProps} onCancel={onCancel} />);
    fireEvent.click(screen.getByText("Cancel"));
    expect(onCancel).toHaveBeenCalled();
  });

  it("calls onCancel on Escape key", () => {
    const onCancel = vi.fn();
    render(<ConfirmDialog {...baseProps} onCancel={onCancel} />);
    fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Escape" });
    expect(onCancel).toHaveBeenCalled();
  });

  it("shows danger warning icon when danger is true", () => {
    render(<ConfirmDialog {...baseProps} danger />);
    expect(screen.getByText("⚠️")).toBeInTheDocument();
  });

  it("applies danger class to confirm button", () => {
    render(<ConfirmDialog {...baseProps} danger />);
    const btn = screen.getByText("Confirm");
    expect(btn).toHaveClass("danger");
  });

  it("disables confirm when busy", () => {
    render(<ConfirmDialog {...baseProps} busy />);
    expect(screen.getByText("Working…")).toBeDisabled();
  });

  it("disables cancel when busy", () => {
    render(<ConfirmDialog {...baseProps} busy />);
    expect(screen.getByText("Cancel")).toBeDisabled();
  });

  it("shows reason textarea when requireReason is true", () => {
    render(<ConfirmDialog {...baseProps} requireReason />);
    expect(screen.getByLabelText("Reason")).toBeInTheDocument();
  });

  it("disables confirm when reason is required but empty", () => {
    render(<ConfirmDialog {...baseProps} requireReason />);
    const confirmBtn = screen.getByText("Confirm");
    expect(confirmBtn).toBeDisabled();
  });

  it("enables confirm when reason is filled", () => {
    render(<ConfirmDialog {...baseProps} requireReason />);
    const textarea = screen.getByLabelText("Reason");
    fireEvent.change(textarea, { target: { value: "Budget approved" } });
    expect(screen.getByText("Confirm")).not.toBeDisabled();
  });

  it("passes trimmed reason to onConfirm", () => {
    const onConfirm = vi.fn();
    render(<ConfirmDialog {...baseProps} requireReason onConfirm={onConfirm} />);
    const textarea = screen.getByLabelText("Reason");
    fireEvent.change(textarea, { target: { value: "  Approved by DDO  " } });
    fireEvent.click(screen.getByText("Confirm"));
    expect(onConfirm).toHaveBeenCalledWith("Approved by DDO");
  });

  it("applies maxReasonLength as the textarea's native maxLength", () => {
    render(<ConfirmDialog {...baseProps} requireReason maxReasonLength={10} />);
    expect(screen.getByLabelText("Reason")).toHaveAttribute("maxlength", "10");
  });

  it("shows a character-count hint when maxReasonLength is set", () => {
    render(<ConfirmDialog {...baseProps} requireReason maxReasonLength={10} />);
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "12345" } });
    expect(screen.getByText(/5\/10 characters/)).toBeInTheDocument();
  });

  it("keeps confirm disabled if a reason somehow exceeds maxReasonLength", () => {
    // Defensive check even though the native maxLength attribute normally
    // prevents this via typing/paste in a real browser.
    render(<ConfirmDialog {...baseProps} requireReason maxReasonLength={5} />);
    const textarea = screen.getByLabelText("Reason");
    fireEvent.change(textarea, { target: { value: "this is way too long" } });
    expect(screen.getByText("Confirm")).toBeDisabled();
  });

  it("displays error message in alert region", () => {
    render(<ConfirmDialog {...baseProps} errorMessage="Server error" />);
    expect(screen.getByRole("alert")).toHaveTextContent("Server error");
  });

  it("calls onCancel when overlay is clicked (not busy)", () => {
    const onCancel = vi.fn();
    const { container } = render(<ConfirmDialog {...baseProps} onCancel={onCancel} />);
    const overlay = container.querySelector(".cd-overlay")!;
    fireEvent.mouseDown(overlay);
    expect(onCancel).toHaveBeenCalled();
  });
});
