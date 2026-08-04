import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ClassificationFields, EMPTY_CLASSIFICATION } from "./ClassificationFields";

describe("ClassificationFields (LQ-003)", () => {
  it("renders all classification controls", () => {
    render(<ClassificationFields value={EMPTY_CLASSIFICATION} onChange={() => {}} />);
    expect(screen.getByLabelText("Temperature")).toBeInTheDocument();
    expect(screen.getByLabelText("Priority")).toBeInTheDocument();
    expect(screen.getByLabelText("Segment")).toBeInTheDocument();
    expect(screen.getByLabelText("Product")).toBeInTheDocument();
    expect(screen.getByLabelText("Region")).toBeInTheDocument();
    expect(screen.getByLabelText(/expected value/i)).toBeInTheDocument();
  });

  it("emits a patch when temperature changes", () => {
    const onChange = vi.fn();
    render(<ClassificationFields value={EMPTY_CLASSIFICATION} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Temperature"), { target: { value: "hot" } });
    expect(onChange).toHaveBeenCalledWith({ temperature: "hot" });
  });

  it("emits a patch when expected value changes", () => {
    const onChange = vi.fn();
    render(<ClassificationFields value={EMPTY_CLASSIFICATION} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText(/expected value/i), { target: { value: "150000" } });
    expect(onChange).toHaveBeenCalledWith({ expectedValueRupees: "150000" });
  });

  it("marks the expected-value field invalid and links the error via aria-describedby", () => {
    render(<ClassificationFields value={EMPTY_CLASSIFICATION} onChange={() => {}} expectedValueError="Enter a valid amount." />);
    const input = screen.getByLabelText(/expected value/i);
    expect(input).toHaveAttribute("aria-invalid", "true");
    const errId = input.getAttribute("aria-describedby");
    expect(errId).toBeTruthy();
    expect(screen.getByRole("alert")).toHaveTextContent("Enter a valid amount.");
  });
});
