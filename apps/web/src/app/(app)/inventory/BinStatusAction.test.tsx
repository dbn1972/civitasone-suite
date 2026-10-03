import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));

const { BinStatusAction } = await import("./BinStatusAction");
const { BinsTable } = await import("./BinsTable");

vi.mock("@/lib/sync/resource", () => ({
  useSeededResource: (_key: string, initialData: unknown[]) => ({
    data: initialData, fromCache: false, offline: false, cachedAt: null, provenance: "live",
  }),
}));

const fetchMock = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
});

const dialogConfirm = () => {
  const dlg = screen.getByRole("alertdialog");
  return Array.from(dlg.querySelectorAll("button")).find((b) => /^(Deactivate|Reactivate)$/.test(b.textContent ?? "")) as HTMLButtonElement;
};

describe("BinStatusAction (GAP-INVENTORY-BINS-03)", () => {
  it("asks for confirmation first: cancelling sends nothing", () => {
    render(<BinStatusAction binId="b1" code="A-01" isActive onChanged={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Deactivate" }));
    expect(screen.getByRole("alertdialog")).toHaveTextContent("Deactivate bin A-01?");
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("PATCHes the status, waits until the register shows it, then reports the new state", async () => {
    fetchMock.mockImplementation(async (url: string, init?: { method?: string }) => {
      if (init?.method === "PATCH") return new Response("{}", { status: 202 });
      return new Response(JSON.stringify({ data: [{ id: "b1", isActive: false }] }), { status: 200 });
    });
    const onChanged = vi.fn();
    render(<BinStatusAction binId="b1" code="A-01" isActive onChanged={onChanged} />);
    fireEvent.click(screen.getByRole("button", { name: "Deactivate" }));
    fireEvent.click(dialogConfirm());
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith("b1", false, true), { timeout: 4000 });
    const patch = fetchMock.mock.calls.find((c) => c[1]?.method === "PATCH")!;
    expect(patch[0]).toBe("/api/proxy/v1/inventory/bins/b1/status");
    expect(JSON.parse(patch[1].body as string)).toEqual({ isActive: false });
  });

  it("a reactivate button is offered for an inactive bin", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 202 }));
    render(<BinStatusAction binId="b1" code="A-01" isActive={false} onChanged={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Reactivate" }));
    expect(screen.getByRole("alertdialog")).toHaveTextContent("Reactivate bin A-01?");
  });

  it("a 409 is shown in plain words and nothing is reported as changed", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ code: "NO_CHANGE", message: "bin is already inactive" }), { status: 409 }));
    const onChanged = vi.fn();
    render(<BinStatusAction binId="b1" code="A-01" isActive onChanged={onChanged} />);
    fireEvent.click(screen.getByRole("button", { name: "Deactivate" }));
    fireEvent.click(dialogConfirm());
    await waitFor(() => expect(screen.getByRole("alertdialog")).toHaveTextContent(/already inactive/i));
    expect(screen.getByRole("alertdialog")).not.toHaveTextContent(/NO_CHANGE|\{/);
    expect(onChanged).not.toHaveBeenCalled();
  });
});

describe("BinsTable role gating (GAP-INVENTORY-BINS-03)", () => {
  const bins = [{ id: "b1", storeId: "s1", code: "A-01", aisle: null, rack: null, shelf: null, capacity: 5, isActive: true, createdAt: "2026-08-01", storeName: "Main" }];

  it("an unauthorised user sees no controls", () => {
    render(<BinsTable bins={bins} />);
    expect(screen.queryByRole("button", { name: /deactivate|reactivate/i })).not.toBeInTheDocument();
  });

  it("a manager sees the control per row", () => {
    render(<BinsTable bins={bins} canManage />);
    expect(screen.getByRole("button", { name: "Deactivate" })).toBeInTheDocument();
  });
});
