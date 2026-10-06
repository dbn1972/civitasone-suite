import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { ApprovalsTable } from "./ApprovalsTable";
import type { MyApprovalItem } from "@/app/_data/loaders";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
// Keep the offline cache out of jsdom; render the server-seeded data directly.
vi.mock("@/lib/sync/resource", () => ({
  useSeededResource: (_k: string, initial: unknown) => ({
    data: initial,
    fromCache: false,
    offline: false,
    cachedAt: null,
    provenance: "live",
  }),
}));

function item(over: Partial<MyApprovalItem>): MyApprovalItem {
  return {
    id: "x", taskId: "x", instanceName: "Task", refType: "leave_app", refId: "r",
    instanceId: "i", module: "leave", status: "pending", assignedAt: "2026-09-01T00:00:00Z",
    dueDate: null, link: "/hr/leave/approvals", ...over,
  };
}

describe("ApprovalsTable (GAP-APPROVALS-HOME-05 / -07)", () => {
  it("renders a humanized module label for a prefix not in the label map", () => {
    render(<ApprovalsTable initialData={[item({ id: "a", module: "works", instanceName: "Works task" })]} source="api" />);
    // "works" -> humanizeStatus -> "Works" (not a raw lowercase code).
    expect(screen.getByText("Works")).toBeInTheDocument();
  });

  it("maps the known 'leave' prefix to its explicit label", () => {
    render(<ApprovalsTable initialData={[item({ id: "b", module: "leave" })]} source="api" />);
    expect(screen.getByText("Leave")).toBeInTheDocument();
  });

  it("marks an overdue row with a text label, not only an emoji", () => {
    render(<ApprovalsTable initialData={[item({ id: "c", dueDate: "2000-01-01T00:00:00Z" })]} source="api" />);
    expect(screen.getByText(/Overdue/)).toBeInTheDocument();
  });

  it("sorts Assigned by real timestamp, not by the display string", () => {
    const rows = [
      item({ id: "older", instanceName: "Older", assignedAt: "2026-01-01T00:00:00Z" }),
      item({ id: "newer", instanceName: "Newer", assignedAt: "2026-09-10T00:00:00Z" }),
    ];
    render(<ApprovalsTable initialData={rows} source="api" />);
    // Click the Assigned header to sort ascending by timestamp.
    fireEvent.click(screen.getByRole("columnheader", { name: /Assigned/ }));
    const bodyRows = screen.getAllByRole("row").slice(1); // drop header row
    const firstRowText = within(bodyRows[0]!).getByText(/Older|Newer/).textContent;
    // Ascending by timestamp -> the Jan ("Older") task comes first, even though
    // its display string ("…ago"/date) would sort differently as text.
    expect(firstRowText).toBe("Older");
  });
});
