import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { TemplateCanvas } from "./TemplateCanvas";

const props = { body: "x", onChange: () => undefined, mergeFields: [], outputType: "certificate" as const };

// Owner decision D4c #10 (GAP-DESIGNER-DETAIL-B7-05): A4 only for UAT, and the
// preview says so, so designers know the paper size.
describe("TemplateCanvas — A4 label", () => {
  it("labels the preview A4 portrait", () => {
    render(<TemplateCanvas {...props} orientation="portrait" />);
    expect(screen.getByTestId("paper-size-label").textContent).toBe("A4 — portrait, 210 × 297 mm");
  });
  it("labels the preview A4 landscape with the swapped size", () => {
    render(<TemplateCanvas {...props} orientation="landscape" />);
    expect(screen.getByTestId("paper-size-label").textContent).toBe("A4 — landscape, 297 × 210 mm");
  });
});
