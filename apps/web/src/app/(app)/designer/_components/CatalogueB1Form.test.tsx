import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CatalogueB1Form, type CatalogueB1Values } from "./CatalogueB1Form";

vi.mock("../_data/designerApi", () => ({
  updateServiceDefinition: vi.fn().mockResolvedValue(undefined),
}));

const initial: CatalogueB1Values = {
  name: "Trade License",
  serviceKey: "trade-license",
  ownerDepartment: "",
  slaDays: 15,
  channels: [],
  statutoryReferences: [{ act: "Act A" }, { act: "Act B" }, { act: "Act C" }],
  servicePattern: "certificate",
};

describe("CatalogueB1Form", () => {
  // Row identity: statutory references were keyed by array position, so
  // removing an earlier reference shifted later ones up into a different
  // key -- React patched the focused reference's DOM node in place with a
  // different reference's data instead of removing the right node and
  // leaving the rest (and focus) alone.
  it("keeps a statutory reference's own value and focus attached to it after an earlier reference is removed", () => {
    render(<CatalogueB1Form definitionId="d1" initial={initial} />);

    const thirdAct = screen.getAllByLabelText(/act name/i)[2] as HTMLInputElement;
    thirdAct.focus();
    expect(thirdAct.value).toBe("Act C");
    expect(document.activeElement).toBe(thirdAct);

    // Remove the first reference -- references 2-3 shift up to become 1-2.
    fireEvent.click(screen.getAllByRole("button", { name: "Remove" })[0]!);

    const survivingThirdAct = screen.getAllByLabelText(/act name/i)[1] as HTMLInputElement;
    expect(survivingThirdAct.value).toBe("Act C");
    expect(document.activeElement).toBe(survivingThirdAct);
  });
});
