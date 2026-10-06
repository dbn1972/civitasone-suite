import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const pushMock = vi.fn();
let searchParamsMock = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
  useSearchParams: () => searchParamsMock,
}));
vi.mock("@/app/_components/ds/Toast", () => ({
  useToast: () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }),
}));
// The shared works adapters hit the network; stub them with a known work.
vi.mock("../../../_data/worksPicker", () => ({
  searchWorkOptions: vi.fn(async () => [
    { id: "11111111-1111-1111-1111-111111111111", label: "W-2025-014", sublabel: "Road repair" },
  ]),
  resolveWorkOptions: vi.fn(async () => []),
}));

import RaiseIssuePage from "./page";

describe("RaiseIssuePage (GAP-WORKS-EXECUTION-ISSUES-NEW-01/02/03/04)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    pushMock.mockReset();
    searchParamsMock = new URLSearchParams();
  });

  it("NEW-01: picks a work by name and posts its id — never a typed UUID", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "x" }), { status: 202 }),
    );
    render(<RaiseIssuePage />);

    // There is no free-text "Work ID" input any more.
    expect(screen.queryByPlaceholderText(/UUID of the work/i)).toBeNull();

    const workBox = screen.getByRole("combobox", { name: /Work/i });
    fireEvent.focus(workBox);
    fireEvent.change(workBox, { target: { value: "W-2025" } });
    const option = await screen.findByText("W-2025-014");
    fireEvent.mouseDown(option);

    fireEvent.change(screen.getByLabelText(/Description/i), {
      target: { value: "Crack in the retaining wall." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Raise Issue" }));

    await waitFor(() => {
      const post = fetchSpy.mock.calls.find(([u]) => String(u).endsWith("/execution/issues"));
      expect(post).toBeTruthy();
      const body = JSON.parse((post![1] as RequestInit).body as string);
      expect(body.workId).toBe("11111111-1111-1111-1111-111111111111");
    });
    // Redirect uses the selected id.
    await waitFor(() =>
      expect(pushMock).toHaveBeenCalledWith("/works/execution/11111111-1111-1111-1111-111111111111"),
    );
  });

  it("NEW-03: with no work selected, submit is blocked client-side and no request is sent", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    render(<RaiseIssuePage />);
    fireEvent.change(screen.getByLabelText(/Description/i), { target: { value: "A problem." } });
    fireEvent.click(screen.getByRole("button", { name: "Raise Issue" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/Select a work/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("NEW-04: a 500 shows a clerk-safe message, never the raw status", async () => {
    searchParamsMock = new URLSearchParams("workId=11111111-1111-1111-1111-111111111111");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 500 }));
    render(<RaiseIssuePage />);
    fireEvent.change(screen.getByLabelText(/Description/i), { target: { value: "A problem." } });
    fireEvent.click(screen.getByRole("button", { name: "Raise Issue" }));

    const alert = await screen.findByRole("alert");
    await waitFor(() => expect(alert).toHaveTextContent(/couldn't save/i));
    expect(alert.textContent).not.toMatch(/\b500\b/);
  });
});
