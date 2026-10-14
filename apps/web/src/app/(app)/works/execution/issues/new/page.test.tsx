import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderWithIntl as render } from "@/lib/testUtils/intl";
import { screen, fireEvent, waitFor } from "@testing-library/react";

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

// Stub FileUpload to immediately report an uploaded attachment.
vi.mock("@/app/_components/ds", async () => {
  const actual = await vi.importActual<typeof import("@/app/_components/ds")>("@/app/_components/ds");
  return {
    ...actual,
    FileUpload: ({ onUploaded }: { onUploaded?: (k: string, m: unknown) => void }) => (
      <button type="button" onClick={() => onUploaded?.("uploads/t/attachment/u/crack.jpg", { fileName: "crack.jpg", size: 4096, mimeType: "image/jpeg" })}>
        mock-attach
      </button>
    ),
  };
});

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

  it("NEW-05: an uploaded attachment is shown by name and its key is posted as attachmentKey", async () => {
    searchParamsMock = new URLSearchParams("workId=11111111-1111-1111-1111-111111111111");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ id: "x" }), { status: 202 }));
    render(<RaiseIssuePage />);
    fireEvent.click(screen.getByText("mock-attach"));
    expect(screen.getByText(/crack\.jpg/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Description/i), { target: { value: "Crack in the wall." } });
    fireEvent.click(screen.getByRole("button", { name: "Raise Issue" }));
    await waitFor(() => {
      const post = fetchSpy.mock.calls.find(([u]) => String(u).endsWith("/execution/issues"));
      expect(post).toBeTruthy();
      expect(JSON.parse((post![1] as RequestInit).body as string).attachmentKey).toBe("uploads/t/attachment/u/crack.jpg");
    });
  });

  it("NEW-05: no attachment -> attachmentKey is not sent", async () => {
    searchParamsMock = new URLSearchParams("workId=11111111-1111-1111-1111-111111111111");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ id: "x" }), { status: 202 }));
    render(<RaiseIssuePage />);
    fireEvent.change(screen.getByLabelText(/Description/i), { target: { value: "Crack in the wall." } });
    fireEvent.click(screen.getByRole("button", { name: "Raise Issue" }));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const body = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string);
    expect("attachmentKey" in body).toBe(false);
  });
});

describe("RaiseIssuePage - re-check of NEW-02 / NEW-04", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    pushMock.mockReset();
    searchParamsMock = new URLSearchParams("workId=11111111-1111-1111-1111-111111111111");
  });

  it("NEW-02: typing a description then Cancel asks before discarding; a clean form leaves straight away", () => {
    const { unmount } = render(<RaiseIssuePage />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(pushMock).toHaveBeenCalledWith("/works/execution/11111111-1111-1111-1111-111111111111");
    unmount();
    pushMock.mockReset();
    render(<RaiseIssuePage />);
    fireEvent.change(screen.getByLabelText(/Description/i), { target: { value: "half written" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(pushMock).not.toHaveBeenCalled();
    expect(screen.getByText("Discard this issue?")).toBeInTheDocument();
  });

  it("NEW-02: the browser warns on tab close only while the form is dirty", () => {
    render(<RaiseIssuePage />);
    const clean = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(clean);
    expect(clean.defaultPrevented).toBe(false);
    fireEvent.change(screen.getByLabelText(/Description/i), { target: { value: "dirty" } });
    const dirty = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(dirty);
    expect(dirty.defaultPrevented).toBe(true);
  });
});
