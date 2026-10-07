import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { StatusPill } from "./StatusPill";
import { humanizeStatus } from "@/lib/formatters";

// GAP-...-TRACK-05: a hyphenated status ("under-review") rendered a label with
// the hyphen kept ("Under-review") and — before the separator fix — could miss
// the tone map. humanizeStatus must now split hyphens, and the tone lookup
// (already hyphen-insensitive via normalizeStatusKey) must resolve.

function renderPill(status: string) {
  const { container } = render(<StatusPill status={status} />);
  const el = container.querySelector(".pill") as HTMLElement;
  const tone = [...el.classList].find((c) => c !== "pill") ?? null;
  return { text: el.textContent, tone };
}

describe("humanizeStatus hyphen handling (TRACK-05)", () => {
  it("splits hyphens into words", () => {
    expect(humanizeStatus("under-review")).toBe("Under Review");
    expect(humanizeStatus("payment-due")).toBe("Payment Due");
  });
  it("still handles underscores and acronyms", () => {
    expect(humanizeStatus("payment_due")).toBe("Payment Due");
    expect(humanizeStatus("na")).toBe("N/A");
  });
});

describe("StatusPill hyphenated status (TRACK-05)", () => {
  it("renders 'under-review' as 'Under Review' with the warn tone", () => {
    const { text, tone } = renderPill("under-review");
    expect(text).toBe("Under Review");
    expect(tone).toBe("warn");
  });
  it("renders 'payment_due' as 'Payment Due' (no tone key -> info)", () => {
    const { text } = renderPill("payment_due");
    expect(text).toBe("Payment Due");
  });
  it("renders 'issued' with the info tone", () => {
    const { text, tone } = renderPill("issued");
    expect(text).toBe("Issued");
    expect(tone).toBe("info");
  });
});
