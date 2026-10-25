import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ApprovalsTable } from "./ApprovalsTable";
import type { MyApprovalItem } from "@/app/_data/loaders";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
// The REAL useSeededResource runs (that is where the bug lived); only the
// IndexedDB-backed cache is stubbed out of jsdom.
vi.mock("@/lib/sync/responseCache", () => ({
  readCache: vi.fn(async () => null),
  writeCache: vi.fn(async () => undefined),
}));

function item(n: number): MyApprovalItem {
  return {
    id: `t${n}`, taskId: `t${n}`, instanceName: `Task ${n}`, refType: "leave_app", refId: `r${n}`,
    instanceId: `i${n}`, module: "leave", status: "pending", assignedAt: "2026-09-01T00:00:00Z",
    dueDate: null, link: "/hr/leave/approvals",
  };
}

const PAGE1 = [item(1), item(2)];
const PAGE2 = [item(16), item(17)];

/** Mimics the Next router soft navigation: the server component re-renders the
 * SAME mounted table with the next page's rows (no remount). */
function Harness() {
  const [page, setPage] = useState(1);
  return (
    <>
      <button onClick={() => setPage(2)}>Next</button>
      <ApprovalsTable initialData={page === 1 ? PAGE1 : PAGE2} source="api" page={page} />
    </>
  );
}

describe("ApprovalsTable paging", () => {
  it("shows the page-2 rows after clicking Next, not the page-1 rows", async () => {
    render(<Harness />);
    expect(screen.getByRole("link", { name: "Task 1" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(screen.getByRole("link", { name: "Task 16" })).toBeInTheDocument());
    expect(screen.getByRole("link", { name: "Task 17" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Task 1" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Task 2" })).not.toBeInTheDocument();
  });
});
