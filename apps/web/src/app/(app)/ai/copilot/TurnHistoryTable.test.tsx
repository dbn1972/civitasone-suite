import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import type { CopilotTurn } from "@civitasone/types";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import { TurnHistoryTable } from "./TurnHistoryTable";

function turn(over: Partial<CopilotTurn> = {}): CopilotTurn {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    userId: null,
    prompt: "x",
    response: "y",
    sourceCitations: [],
    model: "gpt-4o",
    tokens: 10,
    latencyMs: 100,
    createdAt: "2026-08-01T10:00:00.000Z",
    version: 1,
    ...over,
  };
}

describe("TurnHistoryTable (GAP-AI-COPILOT-06)", () => {
  it("exposes the full prompt as a title tooltip, with identity numbers masked", () => {
    const longPrompt =
      "Please review the citizen record for aadhaar 1234 5678 9012 and summarise the pending approvals in detail for the officer";
    render(<TurnHistoryTable turns={[turn({ prompt: longPrompt })]} />);
    // the truncated cell carries a title with the full (masked) prompt
    const cell = document.querySelector("span[title]") as HTMLElement | null;
    expect(cell).not.toBeNull();
    expect(cell!.getAttribute("title")).toContain("XXXX XXXX 9012");
    expect(cell!.getAttribute("title")).not.toContain("1234 5678 9012");
    expect(cell!.getAttribute("title")).toContain("summarise the pending approvals");
  });
});
