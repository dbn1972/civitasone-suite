import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MaskablePromptText } from "./MaskablePromptText";

describe("MaskablePromptText (GAP-AI-COPILOT-DETAIL-03)", () => {
  it("masks a detected Aadhaar by default and reveals on toggle", () => {
    render(<MaskablePromptText text="my aadhaar is 1234 5678 9012" label="prompt" />);
    expect(screen.getByText(/XXXX XXXX 9012/)).toBeInTheDocument();
    const toggle = screen.getByRole("button", { name: /show original prompt/i });
    fireEvent.click(toggle);
    expect(screen.getByText(/1234 5678 9012/)).toBeInTheDocument();
  });

  it("shows ordinary text as-is with no toggle", () => {
    render(<MaskablePromptText text="summarise the pending approvals" label="prompt" />);
    expect(screen.getByText("summarise the pending approvals")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /show original/i })).not.toBeInTheDocument();
  });
});
