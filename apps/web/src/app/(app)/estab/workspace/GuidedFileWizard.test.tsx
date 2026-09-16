import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { GuidedFileWizard } from "./GuidedFileWizard";

describe("GuidedFileWizard — UX-016 clerk-safe errors", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("shows a clerk-safe message, never the raw response body or status, when a step's POST fails", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes("/estab/operators")) return new Response(JSON.stringify({ data: [] }), { status: 200 });
      // The Step 1 "Continue" POST (skip-DAK path isn't taken here, so this
      // only fires when useDak is left checked and the receipt POST runs).
      return new Response("dak_no already diarised this year", { status: 409 });
    });

    render(<GuidedFileWizard />);

    fireEvent.change(screen.getByLabelText(/DAK number/i), { target: { value: "DAK/2026/001" } });
    fireEvent.change(screen.getByLabelText(/From \(sender\)/i), { target: { value: "Ministry of Roads" } });
    fireEvent.change(screen.getByLabelText(/^Subject/i), { target: { value: "Road repair request" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() => expect(screen.getByText(/couldn't save/i)).toBeInTheDocument());
    expect(document.body.textContent).not.toMatch(/dak_no already diarised/i);
    expect(document.body.textContent).not.toMatch(/\b409\b/);
  });
});
