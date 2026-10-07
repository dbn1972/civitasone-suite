import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

import { CaseActions } from "./CaseActions";

describe("CaseActions affidavit control (GAP-LEGAL-CASES-DETAIL-01)", () => {
  it("labels the control 'Record affidavit filing', not 'Upload Affidavit'", () => {
    render(<CaseActions caseId="c1" />);
    expect(screen.getByRole("button", { name: "Record affidavit filing" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Upload Affidavit/i })).not.toBeInTheDocument();
  });
});

describe("CaseActions dialog accessibility (GAP-LEGAL-CASES-DETAIL-05)", () => {
  it("opens an accessible modal dialog (role=dialog, aria-modal) when briefing counsel", async () => {
    render(<CaseActions caseId="c1" />);
    fireEvent.click(screen.getByRole("button", { name: "Brief counsel" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    // The Modal moves focus into the panel on open (focus trap behaviour).
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
  });
});
