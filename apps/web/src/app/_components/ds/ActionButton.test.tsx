import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ActionButton } from "./ActionButton";

describe("ActionButton", () => {
  it("renders the button with label", () => {
    render(
      <ActionButton
        label="Approve"
        confirmTitle="Approve voucher?"
        onConfirm={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Approve" })).toBeInTheDocument();
  });

  it("opens ConfirmDialog on click", () => {
    render(
      <ActionButton
        label="Delete"
        confirmTitle="Delete this record?"
        confirmDescription="This cannot be undone."
        danger
        onConfirm={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(screen.getByText("Delete this record?")).toBeInTheDocument();
    expect(screen.getByText("This cannot be undone.")).toBeInTheDocument();
  });

  it("calls onConfirm when dialog is confirmed", async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(
      <ActionButton
        label="Approve"
        confirmTitle="Approve?"
        onConfirm={onConfirm}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    fireEvent.click(screen.getByText("Confirm"));
    await waitFor(() => expect(onConfirm).toHaveBeenCalled());
  });

  it("closes dialog after successful confirm", async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(
      <ActionButton
        label="Approve"
        confirmTitle="Approve?"
        onConfirm={onConfirm}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    fireEvent.click(screen.getByText("Confirm"));
    await waitFor(() => {
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    });
  });

  it("shows error message when onConfirm throws", async () => {
    const onConfirm = vi.fn().mockRejectedValue(new Error("Server error"));
    render(
      <ActionButton
        label="Approve"
        confirmTitle="Approve?"
        onConfirm={onConfirm}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    fireEvent.click(screen.getByText("Confirm"));
    await waitFor(() => {
      expect(screen.getByText("Server error")).toBeInTheDocument();
    });
  });

  it("closes dialog on cancel", () => {
    render(
      <ActionButton
        label="Delete"
        confirmTitle="Sure?"
        onConfirm={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Cancel"));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("applies danger styling", () => {
    render(
      <ActionButton
        label="Delete"
        confirmTitle="Sure?"
        danger
        onConfirm={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Delete" })).toHaveClass("danger");
  });

  it("button is disabled when disabled prop is true", () => {
    render(
      <ActionButton
        label="Delete"
        confirmTitle="Sure?"
        disabled
        onConfirm={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Delete" })).toBeDisabled();
  });

  it("calls onSuccess after successful confirm", async () => {
    const onSuccess = vi.fn();
    render(
      <ActionButton
        label="Go"
        confirmTitle="Sure?"
        onConfirm={vi.fn().mockResolvedValue(undefined)}
        onSuccess={onSuccess}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Go" }));
    fireEvent.click(screen.getByText("Confirm"));
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
  });
});
