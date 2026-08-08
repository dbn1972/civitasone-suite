import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MergeFieldPicker, renderMergePills } from "./MergeFieldPicker";

describe("MergeFieldPicker", () => {
  it("inserts merge token on field click", () => {
    const onInsert = vi.fn();
    render(<MergeFieldPicker onInsert={onInsert} />);
    fireEvent.click(screen.getByRole("button", { name: "Insert field" }));
    fireEvent.click(screen.getByRole("button", { name: "Applicant name" }));
    expect(onInsert).toHaveBeenCalledWith("{{applicant_name}}");
  });
});

describe("renderMergePills", () => {
  it("replaces braces with pill markers", () => {
    expect(renderMergePills("Hello {{applicant_name}}")).toBe("Hello ⟨applicant_name⟩");
  });
});
