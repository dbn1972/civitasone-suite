import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/app/_components/ds", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/app/_components/ds")>();
  return {
    ...actual,
    useToast: () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }),
  };
});

import { MastersTable } from "./MastersTable";

describe("MastersTable — GAP-WORKS-MASTERS-01 fail-mask", () => {
  it("on a failed fetch shows a retry state, NOT the 'add the first entry' empty state", () => {
    render(
      <MastersTable masterType="authorities" items={[]} failed canManage parentOptions={[]} />,
    );
    expect(screen.getByText(/couldn't load the authorities list/i)).toBeInTheDocument();
    expect(screen.queryByText(/add the first entry/i)).not.toBeInTheDocument();
    // No create control is offered during an outage.
    expect(screen.queryByRole("button", { name: /\+ Add/i })).not.toBeInTheDocument();
  });

  it("on a successful empty list keeps the guided empty state", () => {
    render(
      <MastersTable masterType="authorities" items={[]} failed={false} canManage parentOptions={[]} />,
    );
    expect(screen.getByText(/no authorities yet/i)).toBeInTheDocument();
    expect(screen.getByText(/use the form above to add the first entry/i)).toBeInTheDocument();
  });
});

describe("MastersTable — GAP-WORKS-MASTERS-02 write gating", () => {
  it("hides the create control for a non-admin (canManage=false)", () => {
    render(
      <MastersTable masterType="authorities" items={[]} failed={false} canManage={false} parentOptions={[]} />,
    );
    expect(screen.queryByRole("button", { name: /\+ Add/i })).not.toBeInTheDocument();
  });

  it("shows the create control for an admin (canManage=true)", () => {
    render(
      <MastersTable masterType="authorities" items={[]} failed={false} canManage parentOptions={[]} />,
    );
    expect(screen.getByRole("button", { name: /\+ Add Authorities/i })).toBeInTheDocument();
  });
});

describe("MastersTable — GAP-WORKS-MASTERS-07 per-type columns", () => {
  it("sr-items row shows item code and description (not dashes) and rate as rupees from paise", () => {
    render(
      <MastersTable
        masterType="sr-items"
        items={[{ id: "s1", version: 1, zone: "N", srYear: "2024-25", itemCode: "IT-1", description: "Concrete M20", unit: "cum", rate: "12550" }]}
        failed={false}
        canManage={false}
        parentOptions={[]}
      />,
    );
    expect(screen.getByText("IT-1")).toBeInTheDocument();
    expect(screen.getByText("Concrete M20")).toBeInTheDocument();
    // rate 12550 paise -> ₹125.50
    expect(screen.getByText("₹125.50")).toBeInTheDocument();
  });

  it("renders 'Not set' (not '—') when the API omits active", () => {
    render(
      <MastersTable
        masterType="work-types"
        items={[{ id: "w1", version: 1, name: "Roads", code: "RD" }]}
        failed={false}
        canManage={false}
        parentOptions={[]}
      />,
    );
    expect(screen.getByText("Not set")).toBeInTheDocument();
  });
});

describe("MastersTable — GAP-WORKS-MASTERS-03 parent name", () => {
  it("shows the parent work type NAME, not a UUID, for a work-sub-type row", () => {
    render(
      <MastersTable
        masterType="work-sub-types"
        items={[{ id: "ws1", version: 1, name: "Bituminous", code: "BT", workTypeId: "11111111-1111-4111-8111-111111111111", active: true }]}
        failed={false}
        canManage={false}
        parentOptions={[{ id: "11111111-1111-4111-8111-111111111111", label: "Roads" }]}
      />,
    );
    expect(screen.getByText("Roads")).toBeInTheDocument();
    expect(screen.queryByText(/11111111-1111/)).not.toBeInTheDocument();
  });
});

describe("MastersTable — GAP-WORKS-MASTERS-04 edit/deactivate controls", () => {
  it("offers Edit and Deactivate on an active row when the user can manage", () => {
    render(
      <MastersTable
        masterType="authorities"
        items={[{ id: "a1", version: 2, name: "DAO", code: "DAO", active: true }]}
        failed={false}
        canManage
        parentOptions={[]}
      />,
    );
    expect(screen.getByRole("button", { name: /^Edit$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Deactivate$/i })).toBeInTheDocument();
  });

  it("does NOT offer row actions to a non-admin", () => {
    render(
      <MastersTable
        masterType="authorities"
        items={[{ id: "a1", version: 2, name: "DAO", code: "DAO", active: true }]}
        failed={false}
        canManage={false}
        parentOptions={[]}
      />,
    );
    expect(screen.queryByRole("button", { name: /^Edit$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Deactivate$/i })).not.toBeInTheDocument();
  });
});

describe("MastersTable — GAP2-WORKS-MASTERS-09 truncation notice", () => {
  const rows = Array.from({ length: 100 }, (_v, i) => ({
    id: `a${i}`,
    version: 1,
    name: `Authority ${i}`,
    code: `A${i}`,
    active: true,
  }));

  it("warns 'showing the first N of M' when the true total exceeds the shown page", () => {
    render(
      <MastersTable masterType="authorities" items={rows} failed={false} canManage={false} parentOptions={[]} total={142} />,
    );
    const note = screen.getByText(/showing the first 100 of 142/i);
    expect(note).toBeInTheDocument();
  });

  it("renders NO truncation notice when the page holds the whole set (rows == total)", () => {
    render(
      <MastersTable masterType="authorities" items={rows} failed={false} canManage={false} parentOptions={[]} total={100} />,
    );
    expect(screen.queryByText(/showing the first/i)).not.toBeInTheDocument();
  });

  it("renders NO truncation notice when total is unknown (prop omitted)", () => {
    render(
      <MastersTable masterType="authorities" items={rows} failed={false} canManage={false} parentOptions={[]} />,
    );
    expect(screen.queryByText(/showing the first/i)).not.toBeInTheDocument();
  });
});
