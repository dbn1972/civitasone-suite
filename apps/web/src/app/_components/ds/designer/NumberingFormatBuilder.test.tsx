import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { formatNumberingPreview } from "./issuanceTypes";
import { NumberingFormatBuilder } from "./NumberingFormatBuilder";

describe("formatNumberingPreview", () => {
  it("joins prefix, ward, year, and sequence tokens", () => {
    const preview = formatNumberingPreview([
      { kind: "prefix", value: "TL" },
      { kind: "ward" },
      { kind: "year" },
      { kind: "seq", seqWidth: 5 },
    ]);
    expect(preview).toMatch(/^TL\/W12\/\d{4}\/00041$/);
  });

  it("includes office code segments", () => {
    expect(
      formatNumberingPreview([
        { kind: "prefix", value: "NOC" },
        { kind: "office", value: "FD" },
        { kind: "seq", seqWidth: 4 },
      ]),
    ).toMatch(/^NOC\/FD\/0041$/);
  });
});

describe("NumberingFormatBuilder", () => {
  it("reorders tokens and surfaces warning", () => {
    const onChange = vi.fn();
    render(
      <NumberingFormatBuilder
        tokens={[
          { kind: "prefix", value: "TL" },
          { kind: "year" },
        ]}
        onChange={onChange}
        warning="Include a Sequence segment so each issue gets a unique number."
      />,
    );

    expect(screen.getByTestId("numbering-warning")).toHaveTextContent(/Sequence/i);
    fireEvent.click(screen.getAllByRole("button", { name: "Move token down" })[0]!);
    expect(onChange).toHaveBeenCalledWith([
      { kind: "year" },
      { kind: "prefix", value: "TL" },
    ]);
  });
});
