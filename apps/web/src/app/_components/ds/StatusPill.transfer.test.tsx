import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { StatusPill } from "./StatusPill";
import { TRANSFER_STATUSES, TRANSFER_STATUS_TONE } from "@/lib/hr/transferStatus";

const tone = (status: string, variant?: "good" | "warn" | "mut" | "bad" | "info") => {
  const { container, unmount } = render(<StatusPill status={status} variant={variant} />);
  const el = container.querySelector(".pill");
  const t = el ? [...el.classList].find((c) => c !== "pill") : undefined;
  unmount();
  return t;
};

// GAP-HR-TRANSFER-07: the real transfer-order enum had no keys for "ordered", "joined" and
// "pending effective", so they all fell through to the neutral "info" default.
describe("StatusPill: transfer-order statuses", () => {
  it("ordered reads like 'order issued' (warn), joined is good, pending_effective is warn", () => {
    expect(tone("ordered")).toBe("warn");
    expect(tone("joined")).toBe("good");
    expect(tone("pending_effective")).toBe("warn");
    expect(tone("pending_approval")).toBe("warn");
  });

  it("keeps the tones the map already had for the shared words", () => {
    expect(tone("relieved")).toBe("good");
    expect(tone("cancelled")).toBe("bad");
    expect(tone("completed")).toBe("good");
  });

  it("an explicit tone from the transfer tone map wins, for every transfer status", () => {
    for (const s of TRANSFER_STATUSES) expect(tone(s, TRANSFER_STATUS_TONE[s]), s).toBe(TRANSFER_STATUS_TONE[s]);
  });

  it("'requested' is deliberately left on the neutral default here (other registers share the word)", () => {
    expect(tone("requested")).toBe("info");
  });
});
