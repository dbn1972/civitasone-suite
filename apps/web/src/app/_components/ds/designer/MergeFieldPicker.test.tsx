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

  it("filters fields by search query", () => {
    const onInsert = vi.fn();
    render(
      <MergeFieldPicker
        onInsert={onInsert}
        fields={[
          { key: "applicant_name", label: "Applicant name", group: "Application" },
          { key: "trade_name", label: "Trade name", group: "Form answers" },
        ]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Insert field" }));
    fireEvent.change(screen.getByTestId("merge-field-search"), { target: { value: "trade" } });
    expect(screen.getByRole("button", { name: "Trade name" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Applicant name" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Trade name" }));
    expect(onInsert).toHaveBeenCalledWith("{{trade_name}}");
  });
});

describe("renderMergePills", () => {
  it("replaces braces with pill markers", () => {
    expect(renderMergePills("Hello {{applicant_name}}")).toBe("Hello ⟨applicant_name⟩");
  });
});
