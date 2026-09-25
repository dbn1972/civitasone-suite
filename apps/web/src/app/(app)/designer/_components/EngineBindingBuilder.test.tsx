import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { EngineBindingBuilder } from "./EngineBindingBuilder";
import type { EngineBindingUi } from "@/app/_components/ds/designer/engineBindingTypes";

vi.mock("../_data/engineBindingApi", async (orig) => {
  const actual = await orig<typeof import("../_data/engineBindingApi")>();
  return {
    ...actual,
    fetchEngineRegistry: vi.fn().mockResolvedValue([]),
    previewEngineBinding: vi.fn().mockResolvedValue({
      engineKey: "revenue.assessment",
      available: false,
      lines: [],
      totalMinor: 0,
      currency: "INR",
      appliedExemptions: [],
      note: "",
    }),
    persistEngineBindings: vi.fn().mockResolvedValue(undefined),
  };
});

const binding: EngineBindingUi = {
  id: "b1",
  block: "fee",
  engineKey: "revenue.assessment",
  requiredForPublish: false,
  config: {
    exemptionCategories: [
      { code: "SC", label: "Senior citizen", percentBps: 1000 },
      { code: "BPL", label: "Below poverty line", percentBps: 5000 },
      { code: "DIS", label: "Disability", percentBps: 10000 },
    ],
    penaltyPercentBps: 0,
    rebatePercentBps: 0,
    rebateWindowDays: 0,
    penaltyGraceDays: 0,
    hoaCode: "4201",
    extras: {},
  },
};

describe("EngineBindingBuilder", () => {
  // Row identity: exemption-category rows were keyed by `${code}-${idx}`,
  // which degenerates to plain index-keying whenever two rows share a code
  // (most commonly "" -- a freshly added row starts blank) -- removing an
  // earlier row then shifted a later, focused one into the removed row's
  // key. React patched the focused DOM node in place with a different row's
  // data instead of removing the right node and leaving the rest (and
  // focus) alone.
  it("keeps an exemption category's own value and focus attached to it after an earlier one is removed", () => {
    render(<EngineBindingBuilder definitionId="d1" initial={[binding]} />);

    const thirdCode = screen.getAllByLabelText("Exemption code")[2] as HTMLInputElement;
    thirdCode.focus();
    expect(thirdCode.value).toBe("DIS");
    expect(document.activeElement).toBe(thirdCode);

    // Remove the first category -- categories 2-3 shift up to become 1-2.
    fireEvent.click(screen.getAllByRole("button", { name: "Remove" })[0]!);

    const survivingThirdCode = screen.getAllByLabelText("Exemption code")[1] as HTMLInputElement;
    expect(survivingThirdCode.value).toBe("DIS");
    expect(document.activeElement).toBe(survivingThirdCode);
  });
});
