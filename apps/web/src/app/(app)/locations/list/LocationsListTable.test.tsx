import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@/test-utils/intl-render";
import { LocationsListTable } from "./LocationsListTable";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const ID_HQ = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ID_BR = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const rows = [
  { id: ID_HQ, name: "Head Office", type: "office", parentName: "", lgdCode: "", status: "active" },
  { id: ID_BR, name: "Pune Branch", type: "branch", parentName: "Head Office", lgdCode: "802", status: "active" },
  { id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", name: "Closed Site", type: "facility", parentName: "", lgdCode: "", status: "archived" },
];

describe("LocationsListTable (GAP-LOCATIONS-LIST-02)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("shows type, parent name and LGD code and no raw id", () => {
    render(<LocationsListTable rows={rows} canManage={false} />);
    for (const h of ["Name", "Type", "Parent", "LGD code", "Status"]) expect(screen.getByRole("columnheader", { name: h })).toBeTruthy();
    expect(screen.getByText("Pune Branch")).toBeTruthy();
    expect(screen.getByText("Branch")).toBeTruthy();
    expect(screen.getByText("802")).toBeTruthy();
    expect(screen.getByText("Archived")).toBeTruthy();
    expect(document.body.textContent).not.toContain("aaaaaaaa");
  });

  it("hides every archive control from a viewer who cannot manage", () => {
    render(<LocationsListTable rows={rows} canManage={false} />);
    expect(screen.queryByRole("button", { name: "Archive" })).toBeNull();
  });

  it("a manager gets an archive control only on active rows", () => {
    render(<LocationsListTable rows={rows} canManage />);
    expect(screen.getAllByRole("button", { name: "Archive" })).toHaveLength(2);
  });

  it("archive needs a reason, then PATCHes the archive route; a 409 shows catalogued copy", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ code: "HAS_ACTIVE_CHILDREN", message: "archive its 1 active sub-location(s) first db-7.internal" }), { status: 409 }),
    );
    render(<LocationsListTable rows={rows} canManage />);
    fireEvent.click(screen.getAllByRole("button", { name: "Archive" })[0]!);
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.change(await screen.findByLabelText(/Reason/i), { target: { value: "Merged into HQ" } });
    fireEvent.click(screen.getByRole("button", { name: "Archive location" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(String(fetchMock.mock.calls[0]![0])).toBe(`/api/proxy/v1/locations/${ID_HQ}/archive`);
    expect(JSON.parse(String(fetchMock.mock.calls[0]![1]!.body))).toEqual({ reason: "Merged into HQ" });
    expect(await screen.findByText(/active sub-locations/i)).toBeTruthy();
    expect(document.body.textContent).not.toContain("db-7.internal");
  });

  it("shows the empty state for an empty register", () => {
    render(<LocationsListTable rows={[]} canManage={false} />);
    expect(screen.getByText("No locations yet")).toBeTruthy();
  });
});
