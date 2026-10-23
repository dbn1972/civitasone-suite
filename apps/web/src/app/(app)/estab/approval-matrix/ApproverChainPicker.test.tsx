import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { ApproverChainPicker } from "./ApproverChainPicker";

const CATALOGUE = ["section_officer", "under_secretary", "deputy_secretary"];

function Harness({ initial = [], onChange }: { initial?: string[]; onChange?: (v: string[]) => void }) {
  const [value, setValue] = useState<string[]>(initial);
  return (
    <ApproverChainPicker
      catalogue={CATALOGUE}
      value={value}
      onChange={(v) => { setValue(v); onChange?.(v); }}
    />
  );
}

const chainOf = () => screen.queryAllByRole("listitem").map((li) => li.textContent ?? "");

describe("ApproverChainPicker (GAP-ESTAB-APPROVAL-MATRIX-03)", () => {
  it("offers only the configured roles: an unknown role is not selectable and there is no free text", () => {
    render(<Harness />);
    const select = screen.getByLabelText("Approver role to add") as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.value)).toEqual(["", ...CATALOGUE]);
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("adds roles in the order chosen and removes a role from the picker once it is in the chain", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    expect(screen.getByText(/No approver chosen yet/)).toBeInTheDocument();
    const select = screen.getByLabelText("Approver role to add") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "under_secretary" } });
    fireEvent.click(screen.getByRole("button", { name: "Add approver" }));
    fireEvent.change(select, { target: { value: "section_officer" } });
    fireEvent.click(screen.getByRole("button", { name: "Add approver" }));
    expect(onChange).toHaveBeenLastCalledWith(["under_secretary", "section_officer"]);
    expect(chainOf()).toHaveLength(2);
    expect(chainOf()[0]).toMatch(/Under Secretary/);
    expect(chainOf()[1]).toMatch(/Section Officer/);
    expect(Array.from(select.options).map((o) => o.value)).toEqual(["", "deputy_secretary"]);
  });

  it("the Add button does nothing until a role is picked", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    expect(screen.getByRole("button", { name: "Add approver" })).toBeDisabled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("moves a role earlier and later (that order is the approval order) and disables the ends", () => {
    const onChange = vi.fn();
    render(<Harness initial={["section_officer", "under_secretary", "deputy_secretary"]} onChange={onChange} />);
    expect(screen.getByRole("button", { name: "Move Section Officer earlier in the approval order" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Move Deputy Secretary later in the approval order" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Move Deputy Secretary earlier in the approval order" }));
    expect(onChange).toHaveBeenLastCalledWith(["section_officer", "deputy_secretary", "under_secretary"]);
    fireEvent.click(screen.getByRole("button", { name: "Move Section Officer later in the approval order" }));
    expect(onChange).toHaveBeenLastCalledWith(["deputy_secretary", "section_officer", "under_secretary"]);
  });

  it("removes a role and offers it again", () => {
    render(<Harness initial={["section_officer", "under_secretary"]} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove Section Officer from the approval order" }));
    const select = screen.getByLabelText("Approver role to add") as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.value)).toContain("section_officer");
    expect(chainOf()).toHaveLength(1);
  });

  it("says so, and disables the picker, once every role is in the chain", () => {
    render(<Harness initial={CATALOGUE} />);
    const select = screen.getByLabelText("Approver role to add") as HTMLSelectElement;
    expect(select).toBeDisabled();
    expect(screen.getByRole("option", { name: "All available roles added" })).toBeInTheDocument();
  });
});
