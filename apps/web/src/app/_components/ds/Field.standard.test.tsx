import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { Field } from "./Field";
import { Input } from "./Input";
import { DateInput } from "./DateInput";
import { RequiredLegend } from "./RequiredLegend";

describe("Field: form-field standard (UX-R5)", () => {
  it("shows a hint under the label, wired to the control", () => {
    render(<Field label="Narration" hint="Appears on the ledger"><Input /></Field>);
    const input = screen.getByLabelText("Narration");
    const hint = screen.getByText("Appears on the ledger");
    expect(input.getAttribute("aria-describedby")).toContain(hint.id);
  });

  it("validates a required field on blur with a clear message, and clears it once fixed", () => {
    render(<Field label="Department" required><Input defaultValue="" /></Field>);
    const input = screen.getByLabelText(/Department/);
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.blur(input);
    expect(screen.getByRole("alert")).toHaveTextContent("Department is required.");
    expect(input).toHaveAttribute("aria-invalid", "true");
    fireEvent.change(input, { target: { value: "Finance" } });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("runs a custom validate on blur; an explicit error prop wins", () => {
    const { rerender } = render(<Field label="Code" validate={(v) => (v.length < 3 ? "Use at least 3 characters." : undefined)}><Input defaultValue="ab" /></Field>);
    fireEvent.blur(screen.getByLabelText("Code"));
    expect(screen.getByRole("alert")).toHaveTextContent("Use at least 3 characters.");
    rerender(<Field label="Code" error="Code already in use." validate={() => "x"}><Input defaultValue="ab" /></Field>);
    expect(screen.getByRole("alert")).toHaveTextContent("Code already in use.");
  });

  it("does not flag a field before the officer has left it", () => {
    render(<Field label="Department" required><Input defaultValue="" /></Field>);
    fireEvent.change(screen.getByLabelText(/Department/), { target: { value: "" } });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("required legend", () => {
    render(<RequiredLegend />);
    expect(screen.getByText(/are required/)).toBeInTheDocument();
  });
});

function DateHarness({ onIso, min }: { onIso: (iso: string) => void; min?: string }) {
  const [v, setV] = useState("");
  return (
    <Field label="Posting date" required>
      <DateInput value={v} min={min} onChange={(iso) => { setV(iso); onIso(iso); }} />
    </Field>
  );
}

describe("DateInput: DD-MM-YYYY display, ISO underneath", () => {
  it("shows DD-MM-YYYY for an ISO value", () => {
    render(<Field label="Date"><DateInput value="2026-11-04" onChange={() => {}} /></Field>);
    expect(screen.getByLabelText("Date")).toHaveValue("04-11-2026");
  });

  it("masks typing and reports ISO only for a complete real date", () => {
    const onIso = vi.fn();
    render(<DateHarness onIso={onIso} />);
    const input = screen.getByLabelText(/Posting date/);
    fireEvent.change(input, { target: { value: "0211" } });
    expect(input).toHaveValue("02-11");
    expect(onIso).toHaveBeenLastCalledWith("");
    fireEvent.change(input, { target: { value: "02112026" } });
    expect(input).toHaveValue("02-11-2026");
    expect(onIso).toHaveBeenLastCalledWith("2026-11-02");
  });

  it("checks the date on blur: impossible date, empty required, below min", () => {
    render(<DateHarness onIso={() => {}} min="2026-04-01" />);
    const input = screen.getByLabelText(/Posting date/);
    fireEvent.blur(input);
    expect(screen.getByRole("alert")).toHaveTextContent("Enter the posting date as DD-MM-YYYY.");
    fireEvent.change(input, { target: { value: "31022026" } });
    fireEvent.blur(input);
    expect(screen.getByRole("alert")).toHaveTextContent("31-02-2026 is not a real date.");
    fireEvent.change(input, { target: { value: "01012026" } });
    fireEvent.blur(input);
    expect(screen.getByRole("alert")).toHaveTextContent("cannot be before 01-04-2026");
    fireEvent.change(input, { target: { value: "15062026" } });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("is a text input (never the browser-locale native date picker)", () => {
    render(<Field label="Date"><DateInput value="" onChange={() => {}} /></Field>);
    const input = screen.getByLabelText("Date");
    expect(input).toHaveAttribute("type", "text");
    expect(input).toHaveAttribute("placeholder", "DD-MM-YYYY");
  });
});
