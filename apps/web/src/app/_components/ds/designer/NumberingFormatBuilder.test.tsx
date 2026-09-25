import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { formatNumberingPreview, type NumberingToken } from "./issuanceTypes";
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

  // Row identity: token rows were keyed by `${kind}-${idx}`, which
  // degenerates to plain index-keying whenever two tokens share a kind
  // (nothing stops adding e.g. two Office tokens) -- removing an earlier
  // same-kind token then shifted a later, focused one into the removed
  // token's key.
  it("keeps a token's own value and focus attached to it after an earlier same-kind token is removed", () => {
    function StatefulBuilder() {
      const [tokens, setTokens] = useState<NumberingToken[]>([
        { kind: "office", value: "HO" },
        { kind: "office", value: "FD" },
      ]);
      return <NumberingFormatBuilder tokens={tokens} onChange={setTokens} />;
    }
    render(<StatefulBuilder />);

    const secondOfficeValue = screen.getAllByLabelText("Office code")[1]!;
    secondOfficeValue.focus();
    expect(secondOfficeValue).toHaveValue("FD");
    expect(document.activeElement).toBe(secondOfficeValue);

    // Remove the first office token -- the second shifts up to index 0.
    fireEvent.click(screen.getAllByRole("button", { name: "Remove token" })[0]!);

    const survivingOfficeValue = screen.getAllByLabelText("Office code")[0]!;
    expect(survivingOfficeValue).toHaveValue("FD");
    expect(document.activeElement).toBe(survivingOfficeValue);
  });
});
