import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("../../../_components/crm/DataQualityView", () => ({
  DataQualityView: () => <div data-testid="dq-view" />,
}));

// Preserve the real hasAnyRole + CRM_ADMIN_ROLES; only stub getSessionRoles.
vi.mock("@/lib/auth/roleGuard", async (orig) => {
  const actual = await orig<typeof import("@/lib/auth/roleGuard")>();
  return { ...actual, getSessionRoles: vi.fn(() => [] as string[]) };
});

import Page from "./page";
import * as rg from "@/lib/auth/roleGuard";

beforeEach(() => {
  vi.mocked(rg.getSessionRoles).mockReset();
  vi.mocked(rg.getSessionRoles).mockReturnValue(["crm_user"]);
});

describe("Data Quality page (GoI redesign)", () => {
  it("GAP-CRM-DATA-QUALITY-07: renders the translated title with no hard-coded Devanagari suffix", async () => {
    render(await Page());
    expect(screen.getByRole("heading", { name: "Data Quality" })).toBeInTheDocument();
    expect(screen.queryByText(/डेटा गुणवत्ता/)).not.toBeInTheDocument();
  });

  it("renders the DataQualityView component", async () => {
    render(await Page());
    expect(screen.getByTestId("dq-view")).toBeInTheDocument();
  });

  it("renders GoI context note about RTI disclosures", async () => {
    render(await Page());
    const note = screen.getByRole("note");
    expect(note).toBeInTheDocument();
    expect(note).toHaveTextContent(/RTI/i);
  });

  it("GAP-CRM-DATA-QUALITY-05: hides 'Matching rules' from a plain crm_user", async () => {
    vi.mocked(rg.getSessionRoles).mockReturnValue(["crm_user"]);
    render(await Page());
    expect(screen.queryByRole("link", { name: "Matching rules" })).not.toBeInTheDocument();
  });

  it("GAP-CRM-DATA-QUALITY-05: shows 'Matching rules' to a crm_admin", async () => {
    vi.mocked(rg.getSessionRoles).mockReturnValue(["crm_admin"]);
    render(await Page());
    expect(screen.getByRole("link", { name: "Matching rules" })).toHaveAttribute("href", "/crm/dedup-rules");
  });
});
