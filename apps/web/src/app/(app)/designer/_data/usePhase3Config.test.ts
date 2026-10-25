import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";

const fetchServiceDefinition = vi.fn();
const updateServiceDefinition = vi.fn();

vi.mock("./designerApi", () => ({
  fetchServiceDefinition: (id: string) => fetchServiceDefinition(id),
  updateServiceDefinition: (id: string, body: unknown) => updateServiceDefinition(id, body),
}));

const { usePhase3Config } = await import("./usePhase3Config");

beforeEach(() => {
  vi.useFakeTimers();
  fetchServiceDefinition.mockResolvedValue({
    locales: ["en"],
    officeOverrides: [],
    webhookSubscriptions: [],
    appealLinkage: null,
    rtiLinkage: null,
    renewalPolicy: null,
    offeringOfficeIds: ["office-a"],
  });
  updateServiceDefinition.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
  fetchServiceDefinition.mockReset();
  updateServiceDefinition.mockReset();
});

describe("usePhase3Config", () => {
  it("coalesces rapid edits into a single write", async () => {
    // An update is a CQRS command — outbox message, consumer apply, audit row,
    // cache invalidation. Per-keystroke saving would make typing one designation
    // produce two dozen audit entries.
    const { result } = renderHook(() => usePhase3Config("def-1"));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });

    act(() => {
      result.current.patch({ appealLinkage: { appealable: true, appellateDesignationId: "a" } });
      result.current.patch({ appealLinkage: { appealable: true, appellateDesignationId: "ad" } });
      result.current.patch({ appealLinkage: { appealable: true, appellateDesignationId: "add" } });
    });

    expect(updateServiceDefinition).not.toHaveBeenCalled();

    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });

    expect(updateServiceDefinition).toHaveBeenCalledTimes(1);
    expect(updateServiceDefinition.mock.calls[0]![1]).toEqual({
      appealLinkage: { appealable: true, appellateDesignationId: "add" },
    });
  });

  it("reflects an edit locally before it is written", async () => {
    const { result } = renderHook(() => usePhase3Config("def-1"));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });

    act(() => { result.current.patch({ locales: ["en", "or"] }); });

    // Typing must never be blocked on the round trip.
    expect(result.current.config.locales).toEqual(["en", "or"]);
    expect(updateServiceDefinition).not.toHaveBeenCalled();

    // Drain before the test ends: flush-on-unmount is real behaviour, so a
    // pending edit left here would be written during cleanup and counted
    // against the next test.
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  });

  it("merges edits to different blocks into one write", async () => {
    const { result } = renderHook(() => usePhase3Config("def-1"));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });

    act(() => {
      result.current.patch({ locales: ["en", "or"] });
      result.current.patch({ rtiLinkage: { published: true, pioDesignationId: "pio" } });
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });

    expect(updateServiceDefinition).toHaveBeenCalledTimes(1);
    expect(updateServiceDefinition.mock.calls[0]![1]).toEqual({
      locales: ["en", "or"],
      rtiLinkage: { published: true, pioDesignationId: "pio" },
    });
  });

  it("never sends offeringOfficeIds back", async () => {
    // It belongs to B1; echoing it would let this hook overwrite a B1 edit.
    const { result } = renderHook(() => usePhase3Config("def-1"));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });

    act(() => { result.current.patch({ offeringOfficeIds: ["office-b"], locales: ["en"] }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });

    expect(updateServiceDefinition.mock.calls[0]![1]).toEqual({ locales: ["en"] });
  });

  it("flushes a pending edit on unmount instead of losing it", async () => {
    // A designer who types then immediately clicks Next must not lose the edit.
    const { result, unmount } = renderHook(() => usePhase3Config("def-1"));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });

    act(() => { result.current.patch({ locales: ["en", "hi"] }); });
    // flush() invokes the write synchronously before its first await, so the
    // call is observable immediately after unmount — no waiting required, which
    // matters because waitFor does not progress under fake timers.
    unmount();

    expect(updateServiceDefinition).toHaveBeenCalledTimes(1);
    expect(updateServiceDefinition.mock.calls[0]![1]).toEqual({ locales: ["en", "hi"] });
  });

  it("reports offline when a write fails, and keeps the typed value", async () => {
    updateServiceDefinition.mockRejectedValue(new Error("network"));
    const { result } = renderHook(() => usePhase3Config("def-1"));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });

    act(() => { result.current.patch({ locales: ["en", "or"] }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });

    expect(result.current.saveState).toBe("offline");
    // Not rolled back — a value that appeared and then vanished would just be retyped.
    expect(result.current.config.locales).toEqual(["en", "or"]);
  });

  it("says offline rather than showing an empty config when loading fails", async () => {
    fetchServiceDefinition.mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => usePhase3Config("def-1"));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });

    expect(result.current.loaded).toBe(true);
    expect(result.current.saveState).toBe("offline");
  });
});

// CLOS3-S1-08: flush() cleared `pending` before the request and never restored it on failure, so an
// edit from a failed save was dropped from every later save while the screen still showed it.
describe("usePhase3Config failed-save restore (CLOS3-S1-08)", () => {
  const tick = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };

  // A restored (unsent) edit is flushed when the hook unmounts. Unmount here, inside this suite, so that
  // flush is not counted against the next test.
  afterEach(() => {
    cleanup();
    updateServiceDefinition.mockClear();
  });

  it("re-sends an edit from a failed save with the next successful save", async () => {
    updateServiceDefinition.mockRejectedValueOnce(new Error("network"));
    const { result } = renderHook(() => usePhase3Config("def-1"));
    await tick(0);

    act(() => { result.current.patch({ locales: ["en", "hi"] }); });
    await tick(2100);
    expect(result.current.saveState).toBe("offline");

    act(() => { result.current.patch({ renewalPolicy: { enabled: true } as never }); });
    await tick(2100);

    expect(updateServiceDefinition).toHaveBeenCalledTimes(2);
    expect(updateServiceDefinition.mock.calls[1]![1]).toEqual({
      locales: ["en", "hi"],
      renewalPolicy: { enabled: true },
    });
    expect(result.current.saveState).toBe("saved");
  });

  it("a newer edit to the same key wins over the restored one", async () => {
    updateServiceDefinition.mockRejectedValueOnce(new Error("network"));
    const { result } = renderHook(() => usePhase3Config("def-1"));
    await tick(0);

    act(() => { result.current.patch({ locales: ["en", "hi"] }); });
    await tick(2100);
    act(() => { result.current.patch({ locales: ["en", "or"] }); });
    await tick(2100);

    expect(updateServiceDefinition.mock.calls[1]![1]).toEqual({ locales: ["en", "or"] });
  });

  it("never sends offeringOfficeIds, even after a restore", async () => {
    updateServiceDefinition.mockRejectedValueOnce(new Error("network"));
    const { result } = renderHook(() => usePhase3Config("def-1"));
    await tick(0);

    act(() => { result.current.patch({ offeringOfficeIds: ["office-b"], locales: ["en", "hi"] }); });
    await tick(2100);
    act(() => { result.current.patch({ rtiLinkage: { published: true, pioDesignationId: "pio" } }); });
    await tick(2100);

    expect(updateServiceDefinition.mock.calls[1]![1]).toEqual({
      locales: ["en", "hi"],
      rtiLinkage: { published: true, pioDesignationId: "pio" },
    });
  });

  it("does not retry on its own after a failure (no retry storm)", async () => {
    updateServiceDefinition.mockRejectedValue(new Error("network"));
    const { result } = renderHook(() => usePhase3Config("def-1"));
    await tick(0);

    act(() => { result.current.patch({ locales: ["en", "hi"] }); });
    await tick(20000);

    expect(updateServiceDefinition).toHaveBeenCalledTimes(1);
  });

  it("serialises saves so a slow failure cannot overwrite a newer edit", async () => {
    let rejectFirst: (e: unknown) => void = () => {};
    updateServiceDefinition.mockImplementationOnce(() => new Promise<void>((_, rej) => { rejectFirst = rej; }));
    const { result } = renderHook(() => usePhase3Config("def-1"));
    await tick(0);

    act(() => { result.current.patch({ locales: ["en", "hi"] }); });
    await tick(2100);
    expect(updateServiceDefinition).toHaveBeenCalledTimes(1);

    act(() => { result.current.patch({ locales: ["en", "or"] }); });
    await tick(2100);
    // The second save waits for the first to settle; it must not race it.
    expect(updateServiceDefinition).toHaveBeenCalledTimes(1);

    await act(async () => { rejectFirst(new Error("slow failure")); });
    await tick(0);

    expect(updateServiceDefinition).toHaveBeenCalledTimes(2);
    expect(updateServiceDefinition.mock.calls[1]![1]).toEqual({ locales: ["en", "or"] });
    expect(result.current.saveState).toBe("saved");
  });
});
