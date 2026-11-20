import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as rtlRender, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { IntlWrapper } from "@/lib/testUtils/intl";
import { __resetOfficerMapsCacheForTest } from "../../files/[id]/OfficerName";
import { ActionPointsTable } from "./MeetingDetailTables";

const render = (ui: ReactElement) => rtlRender(ui, { wrapper: IntlWrapper });
const OWNER = "82310d88-1111-4111-8111-111111111111";

describe("ActionPointsTable owner", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    __resetOfficerMapsCacheForTest();
  });

  it("resolves an officer id to a name instead of printing the raw id", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/estab/officers/resolve")) {
        return new Response(JSON.stringify({ data: [{ id: OWNER, displayName: "S. Krishnan" }] }), { status: 200 });
      }
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    });
    render(<ActionPointsTable rows={[{ id: "a1", description: "Follow up", assignedTo: OWNER, dueDate: null, status: "open" }]} />);
    await waitFor(() => expect(screen.getByText("S. Krishnan")).toBeInTheDocument());
    expect(screen.queryByText(OWNER)).toBeNull();
  });

  it("keeps a free-text owner as written", () => {
    render(<ActionPointsTable rows={[{ id: "a2", description: "x", assignedTo: "Priya", dueDate: null, status: "open" }]} />);
    expect(screen.getByText("Priya")).toBeInTheDocument();
  });
});
