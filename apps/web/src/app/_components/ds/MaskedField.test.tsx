import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { MaskedField } from "./MaskedField";

function Harness({ maskedValue, error, onEditingChange }: { maskedValue?: string | null; error?: string; onEditingChange?: (e: boolean) => void }) {
  const [value, setValue] = useState("");
  return (
    <>
      <MaskedField
        label="Account"
        maskedValue={maskedValue}
        value={value}
        onChange={setValue}
        error={error}
        currentLabel={`Current: ${maskedValue ?? ""}`}
        changeLabel="Change"
        keepLabel="Keep current"
        onEditingChange={onEditingChange}
      >
        <span data-testid="extra">confirm goes here</span>
      </MaskedField>
      <output data-testid="state">{value}</output>
    </>
  );
}

describe("MaskedField", () => {
  it("shows the masked value read-only with a Change button and NO input", () => {
    render(<Harness maskedValue="******7890" />);
    expect(screen.getByText("Current: ******7890")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Change: Account" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByTestId("extra")).not.toBeInTheDocument();
  });

  it("reveals an EMPTY, focused input (plus the extra controls) on Change, never seeded with the mask", () => {
    render(<Harness maskedValue="******7890" />);
    fireEvent.click(screen.getByRole("button", { name: "Change: Account" }));
    const input = screen.getByRole("textbox", { name: "Account" });
    expect(input).toHaveValue("");
    expect(input).toHaveFocus();
    expect(screen.getByTestId("extra")).toBeInTheDocument();
    // the current value stays visible as helper text while editing
    expect(screen.getByText("Current: ******7890")).toBeInTheDocument();
  });

  it("passes typed text to onChange", () => {
    render(<Harness maskedValue="******7890" />);
    fireEvent.click(screen.getByRole("button", { name: "Change: Account" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Account" }), { target: { value: "123456789" } });
    expect(screen.getByTestId("state")).toHaveTextContent("123456789");
  });

  it("'Keep current' clears what was typed, collapses again and reports the editing flag", () => {
    const onEditingChange = vi.fn();
    render(<Harness maskedValue="******7890" onEditingChange={onEditingChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Change: Account" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Account" }), { target: { value: "999" } });
    fireEvent.click(screen.getByRole("button", { name: "Keep current" }));
    expect(screen.getByTestId("state")).toHaveTextContent("");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(onEditingChange.mock.calls).toEqual([[true], [false]]);
  });

  it.each([undefined, null, "", "  "])("with nothing on file (%j) the plain input shows straight away, with no Change / Keep buttons", (maskedValue) => {
    render(<Harness maskedValue={maskedValue} />);
    expect(screen.getByRole("textbox", { name: "Account" })).toHaveValue("");
    expect(screen.queryByRole("button", { name: /change/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Keep current" })).not.toBeInTheDocument();
    expect(screen.getByTestId("extra")).toBeInTheDocument();
  });

  it("surfaces a field error in both states", () => {
    const { unmount } = render(<Harness maskedValue="******7890" error="Server says no" />);
    expect(screen.getByRole("alert")).toHaveTextContent("Server says no");
    unmount();
    render(<Harness maskedValue={null} error="Server says no" />);
    expect(screen.getByRole("alert")).toHaveTextContent("Server says no");
  });
});
