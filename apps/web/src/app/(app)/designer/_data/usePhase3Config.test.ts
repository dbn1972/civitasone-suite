import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

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
