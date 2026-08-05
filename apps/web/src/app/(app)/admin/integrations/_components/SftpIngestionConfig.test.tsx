import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SftpIngestionConfig } from "./SftpIngestionConfig";
import type { IngestionConfigDraft } from "@/lib/admin/sftpIngestion";

function draft(over: Partial<IngestionConfigDraft> = {}): IngestionConfigDraft {
  return {
    inboundPath: "/inbound",
    filePattern: "*.csv",
    archivePath: "",
    leadSource: false,
    leadSourceLabel: "",
    mapping: [],
    ...over,
  };
}

describe("SftpIngestionConfig", () => {
  it("hides the label field until leadSource is on", () => {
    const onChange = vi.fn();
    const { rerender } = render(<SftpIngestionConfig draft={draft({ leadSource: false })} onChange={onChange} />);
    expect(screen.queryByLabelText(/lead source label/i)).not.toBeInTheDocument();
    rerender(<SftpIngestionConfig draft={draft({ leadSource: true })} onChange={onChange} />);
    expect(screen.getByLabelText(/lead source label/i)).toBeInTheDocument();
  });

  it("marks the label invalid (aria-invalid) when leadSource on + label blank", () => {
    render(<SftpIngestionConfig draft={draft({ leadSource: true, leadSourceLabel: "", mapping: [{ column: "E", field: "email" }] })} onChange={vi.fn()} />);
    const label = screen.getByLabelText(/lead source label/i);
    expect(label).toHaveAttribute("aria-invalid", "true");
    expect(label).toHaveAttribute("aria-required", "true");
    expect(screen.getByRole("alert")).toHaveTextContent(/source label is required/i);
  });

  it("shows the mapping error when leadSource on + no email/mobile mapping", () => {
    render(<SftpIngestionConfig draft={draft({ leadSource: true, leadSourceLabel: "Partner", mapping: [{ column: "Name", field: "name" }] })} onChange={vi.fn()} />);
    expect(screen.getByText(/at least one column to email or mobile/i)).toBeInTheDocument();
  });

  it("is clean (no alerts) when leadSource on + label + email mapping", () => {
    render(<SftpIngestionConfig draft={draft({ leadSource: true, leadSourceLabel: "Partner", mapping: [{ column: "E", field: "email" }] })} onChange={vi.fn()} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    const label = screen.getByLabelText(/lead source label/i);
    expect(label).not.toHaveAttribute("aria-invalid");
  });

  // Assert on column/field only — rows also carry a stable `id` (React key).
  function mappingOf(call: unknown): Array<{ column: string; field: string }> {
    const draftArg = (call as [IngestionConfigDraft])[0];
    return draftArg.mapping.map(({ column, field }) => ({ column, field }));
  }

  it("adds a mapping row (with a stable id) via '+ Add column mapping'", () => {
    const onChange = vi.fn();
    render(<SftpIngestionConfig draft={draft()} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /add column mapping/i }));
    expect(mappingOf(onChange.mock.calls[0])).toEqual([{ column: "", field: "name" }]);
    // the emitted row carries a stable id for keying
    expect((onChange.mock.calls[0][0] as IngestionConfigDraft).mapping[0].id).toBeTruthy();
  });

  it("removes a mapping row via its remove button", () => {
    const onChange = vi.fn();
    render(<SftpIngestionConfig draft={draft({ mapping: [{ id: "a", column: "E", field: "email" }, { id: "b", column: "P", field: "mobile" }] })} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /remove mapping 1/i }));
    expect(mappingOf(onChange.mock.calls[0])).toEqual([{ column: "P", field: "mobile" }]);
  });

  it("edits a column name and a field select", () => {
    const onChange = vi.fn();
    render(<SftpIngestionConfig draft={draft({ mapping: [{ id: "a", column: "E", field: "email" }] })} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText(/file column 1/i), { target: { value: "Email Addr" } });
    expect(mappingOf(onChange.mock.calls[0])).toEqual([{ column: "Email Addr", field: "email" }]);
    fireEvent.change(screen.getByLabelText(/lead field for column 1/i), { target: { value: "city" } });
    expect(mappingOf(onChange.mock.calls[1])).toEqual([{ column: "E", field: "city" }]);
  });
});
