import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { InstancesTable } from "./InstancesTable";
import type { WorkflowInstance } from "../_data/workflowTypes";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/workflow/list",
}));

const INSTANCE: WorkflowInstance = {
  id: "11111111-2222-3333-4444-555555555555",
  name: "Leave #42",
  status: "active",
  version: 1,
  definitionName: "leave_approval",
  definitionCode: "LEAVE",
  refType: "leave_app",
  refId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  currentNode: "manager_review",
  createdAt: "2026-01-15T10:00:00.000Z",
};

describe("InstancesTable — GAP-WORKFLOW-LIST-03/04", () => {
  it("renders the definition, subject and current step columns", () => {
    render(<InstancesTable instances={[INSTANCE]} />);
    expect(screen.getByText("Leave Approval")).toBeInTheDocument(); // definition titleCased
    expect(screen.getByText(/Leave App ·/)).toBeInTheDocument(); // subject from refType + short refId
    expect(screen.getByText("Manager Review")).toBeInTheDocument(); // current step titleCased
  });

  it("renders a formatted Started date, not a raw ISO string", () => {
    render(<InstancesTable instances={[INSTANCE]} />);
    expect(screen.queryByText("2026-01-15T10:00:00.000Z")).not.toBeInTheDocument();
    // formatIndianDate renders the year somewhere in the cell.
    expect(screen.getByText(/2026/)).toBeInTheDocument();
  });

  it("exposes the full id via a copy button title (not just an ellipsised fragment)", () => {
    render(<InstancesTable instances={[INSTANCE]} />);
    const copy = screen.getByRole("button", { name: /copy full id/i });
    expect(copy).toHaveAttribute("title", INSTANCE.id);
  });
});
