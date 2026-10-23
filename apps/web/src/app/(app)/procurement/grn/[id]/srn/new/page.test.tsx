import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@/test-utils/intl-render";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

let sessionName: string | null = null;
let sessionUserId: string | null = null;
vi.mock("@/lib/auth/roleGuard", () => ({
  getSessionName: () => sessionName,
  getSessionUserId: () => sessionUserId,
}));
vi.mock("../../../../../../_data/loaders", () => ({
  getProcurementGRNById: async () => ({ data: { grnNo: "GRN/2026/1", items: [] }, source: "api" }),
}));

import NewSrnPage from "./page";

// GAP-PROCUREMENT-GRN-DETAIL-SRN-NEW-04 - the page shows the signed-in officer's
// name, never a raw JWT `sub` UUID.
describe("NewSrnPage officer label", () => {
  beforeEach(() => { sessionName = null; sessionUserId = null; });

  it("renders the session display name", async () => {
    sessionName = "A. Officer";
    sessionUserId = "11111111-2222-4333-8444-555555555555";
    render(await NewSrnPage({ params: Promise.resolve({ id: "g1" }) }));
    expect(screen.getByText("A. Officer")).toBeInTheDocument();
    expect(screen.queryByText(sessionUserId)).toBeNull();
  });

  it("falls back to a short hint, never the full UUID, when only the id is known", async () => {
    sessionUserId = "11111111-2222-4333-8444-555555555555";
    render(await NewSrnPage({ params: Promise.resolve({ id: "g1" }) }));
    expect(screen.getByText("Officer (…555555)")).toBeInTheDocument();
    expect(screen.queryByText(sessionUserId)).toBeNull();
  });

  it("shows 'You' with no session identity at all (the server still sets the officer)", async () => {
    render(await NewSrnPage({ params: Promise.resolve({ id: "g1" }) }));
    expect(screen.getByText("You")).toBeInTheDocument();
  });
});
