import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { AskCopilotForm } from "./AskCopilotForm";

describe("AskCopilotForm (GAP-AI-COPILOT-02)", () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it("always shows the DPDP helper notice", () => {
    render(<AskCopilotForm />);
    expect(screen.getByText(/Do not enter Aadhaar, PAN, bank account or PPO numbers/i)).toBeInTheDocument();
  });

  it("warns before submit when a 12-digit Aadhaar is typed, and does not send", async () => {
    const fetchSpy = vi.spyOn(global, "fetch");
    render(<AskCopilotForm />);
    const textarea = screen.getByLabelText("Prompt");
    fireEvent.change(textarea, { target: { value: "aadhaar 1234 5678 9012" } });
    // the inline warning appears
    expect(screen.getByText(/appears to contain an identity number/i)).toBeInTheDocument();
    // attempting to submit without acknowledging does not call fetch
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("does not warn for ordinary text", () => {
    render(<AskCopilotForm />);
    fireEvent.change(screen.getByLabelText("Prompt"), { target: { value: "summarise pending approvals" } });
    expect(screen.queryByText(/appears to contain an identity number/i)).not.toBeInTheDocument();
  });
});
