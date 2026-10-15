import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithIntl as render } from "@/lib/testUtils/intl";

vi.mock("@/app/_components/ds", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/app/_components/ds")>();
  return {
    ...actual,
    useToast: () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }),
  };
});

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

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

describe("MastersTable: SF-15 accepted notice after an edit", () => {
  it("keeps the accepted notice after the edit form closes, and refreshes only on request", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 202 }));
    render(
      <MastersTable
        masterType="work-types"
        items={[{ id: "wt-9", version: 4, name: "Roads", code: "RD", active: true }]}
        failed={false}
        canManage
        parentOptions={[]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^Edit$/i }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    // GAP-WORKS-MASTERS-05: the table now confirms the edit against the type's own GET (bounded poll), so the
    // honest in-between state is "pending" (received, being applied); the notice still outlives the closed form.
    await waitFor(() => expect(document.querySelector('[data-accepted-phase="pending"]')).not.toBeNull());
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Refresh now/i }));
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});

describe("MastersTable: GAP-WORKS-MASTERS-04 deactivate + Unit column", () => {
  it("Deactivate asks for confirmation and PATCHes active=false with the row version", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 202 }));
    render(
      <MastersTable
        masterType="authorities"
        items={[{ id: "a1", version: 7, name: "DAO", code: "DAO", active: true }]}
        failed={false}
        canManage
        parentOptions={[]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^Deactivate$/i }));
    // Nothing is sent until the dialog is confirmed.
    expect(fetchSpy).not.toHaveBeenCalled();
    await screen.findByRole("button", { name: /^Cancel$/i });
    const confirmButtons = screen.getAllByRole("button", { name: /^Deactivate$/i });
    fireEvent.click(confirmButtons[confirmButtons.length - 1]!);
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/proxy/v1/works/masters/authorities/a1");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(String(init.body))).toEqual({ active: false, version: 7 });
  });

  it("scopes show a Unit column", () => {
    render(
      <MastersTable
        masterType="scopes"
        items={[{ id: "s1", version: 1, name: "Earthwork", unit: "cum", workTypeId: "wt1", active: true }]}
        failed={false}
        canManage={false}
        parentOptions={[{ id: "wt1", label: "Roads" }]}
      />,
    );
    expect(screen.getByRole("columnheader", { name: /^Unit/i })).toBeInTheDocument();
    expect(screen.getByText("cum")).toBeInTheDocument();
  });
});

describe("MastersTable: GAP-WORKS-MASTERS-05 pending row + duplicate-submit block", () => {
  it("after a create 202 shows a Pending row, locks the Add control, then confirms when the list total grows", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    // 1st call: the POST (202). Then the confirmation poll: first still old total, then grown.
    fetchSpy
      .mockResolvedValueOnce(new Response("", { status: 202 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [], meta: { total: 1 } }), { status: 200 }))
      .mockResolvedValue(new Response(JSON.stringify({ data: [], meta: { total: 2 } }), { status: 200 }));
    render(
      <MastersTable
        masterType="work-types"
        items={[{ id: "wt-9", version: 1, name: "Roads", code: "RD", active: true }]}
        total={1}
        failed={false}
        canManage
        parentOptions={[]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "+ Add Work Types" }));
    fireEvent.change(screen.getByLabelText(/^Name/i), { target: { value: "Bridges" } });
    fireEvent.change(screen.getByLabelText(/^Code/i), { target: { value: "BR" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    const pendingRow = await screen.findByText("Bridges");
    expect(pendingRow.closest("tr")).toHaveTextContent(/Pending/);
    const add = screen.getByRole("button", { name: "+ Add Work Types" });
    expect(add).toBeDisabled();
    // The poll sees total 2 -> confirmed -> pending row dropped and the page refreshed.
    await waitFor(() => expect(document.querySelector('[data-accepted-phase="confirmed"]')).not.toBeNull(), { timeout: 5000 });
    expect(screen.queryByText("Bridges")).not.toBeInTheDocument();
    expect(refresh).toHaveBeenCalled();
  });
});
