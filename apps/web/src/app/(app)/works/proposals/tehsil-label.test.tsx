/**
 * Owner decision D4c #39: the sub-district field is labelled "Tehsil / Block" (never "Taluka") wherever a work
 * proposal's location is entered or shown.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@/test-utils/intl-render";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/app/_components/ds/Toast", () => ({
  useToast: () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }),
}));

import NewProposalPage from "./new/page";
import { ProposalEditToggle } from "./[id]/ProposalEditToggle";

describe("Tehsil / Block label (D4c #39)", () => {
  it("the new-proposal form labels the sub-district field Tehsil / Block", () => {
    render(<NewProposalPage />);
    expect(screen.getByLabelText("Tehsil / Block")).toBeInTheDocument();
    expect(screen.queryByLabelText(/taluka/i)).toBeNull();
  });

  it("the edit form labels it Tehsil / Block and still saves the same field", () => {
    render(<ProposalEditToggle proposal={{ id: "p1", status: "draft", description: "d", district: "Pune", taluka: "Haveli", village: "W", remarks: null, estimatedCostMinor: "1000" }} roles={["works_admin"]} />);
    fireEvent.click(screen.getByRole("button", { name: /Edit/i }));
    expect(screen.getByLabelText("Tehsil / Block")).toHaveValue("Haveli");
    expect(screen.queryByLabelText(/taluka/i)).toBeNull();
  });
});
