import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { EngineBindingBuilder } from "./EngineBindingBuilder";
import { previewEngineBinding } from "../_data/engineBindingApi";
import type {
  EngineBindingUi,
  EnginePreviewResultUi,
} from "@/app/_components/ds/designer/engineBindingTypes";

vi.mock("../_data/engineBindingApi", async (orig) => {
  const actual = await orig<typeof import("../_data/engineBindingApi")>();
  return {
    ...actual,
    fetchEngineRegistry: vi.fn().mockResolvedValue([]),
    previewEngineBinding: vi.fn().mockResolvedValue({
      engineKey: "revenue.assessment",
      available: false,
      lines: [],
      totalMinor: 0,
      currency: "INR",
      appliedExemptions: [],
      note: "",
    }),
    persistEngineBindings: vi.fn().mockResolvedValue(undefined),
  };
});

const binding: EngineBindingUi = {
  id: "b1",
  block: "fee",
  engineKey: "revenue.assessment",
  requiredForPublish: false,
  config: {
    exemptionCategories: [
      { code: "SC", label: "Senior citizen", percentBps: 1000 },
      { code: "BPL", label: "Below poverty line", percentBps: 5000 },
      { code: "DIS", label: "Disability", percentBps: 10000 },
    ],
    penaltyPercentBps: 0,
    rebatePercentBps: 0,
    rebateWindowDays: 0,
    penaltyGraceDays: 0,
    hoaCode: "4201",
    extras: {},
  },
};

describe("EngineBindingBuilder", () => {
  // Row identity: exemption-category rows were keyed by `${code}-${idx}`,
  // which degenerates to plain index-keying whenever two rows share a code
  // (most commonly "" -- a freshly added row starts blank) -- removing an
  // earlier row then shifted a later, focused one into the removed row's
  // key. React patched the focused DOM node in place with a different row's
  // data instead of removing the right node and leaving the rest (and
  // focus) alone.
  it("keeps an exemption category's own value and focus attached to it after an earlier one is removed", () => {
    render(<EngineBindingBuilder definitionId="d1" initial={[binding]} />);

    const thirdCode = screen.getAllByLabelText("Exemption code")[2] as HTMLInputElement;
    thirdCode.focus();
    expect(thirdCode.value).toBe("DIS");
    expect(document.activeElement).toBe(thirdCode);

    // Remove the first category -- categories 2-3 shift up to become 1-2.
    fireEvent.click(screen.getAllByRole("button", { name: "Remove" })[0]!);

    const survivingThirdCode = screen.getAllByLabelText("Exemption code")[1] as HTMLInputElement;
    expect(survivingThirdCode.value).toBe("DIS");
    expect(document.activeElement).toBe(survivingThirdCode);
  });

  // Fetch cancellation: the preview-timer effect's unmount guard only ever
  // cleared the *debounce timer*, not an in-flight preview fetch. Once the
  // 300ms debounce elapsed, switching to a different binding before the
  // fetch resolved could still land the first binding's preview data under
  // the second (now-selected) binding. This reproduces that race and proves
  // the stale response is discarded: binding 1's fetch is left pending (it
  // only settles -- by rejecting, like a real aborted fetch -- once the
  // component's AbortController fires), we switch to binding 2 before it
  // resolves, let binding 2's fetch resolve normally, and only then let
  // binding 1's late response arrive. It must never reach the screen.
  it("discards a stale preview response after switching bindings mid-flight", async () => {
    vi.useFakeTimers();
    const mockPreview = vi.mocked(previewEngineBinding);
    mockPreview.mockClear();

    const staleResult: EnginePreviewResultUi = {
      engineKey: "revenue.assessment",
      available: true,
      lines: [],
      totalMinor: 111,
      currency: "INR",
      appliedExemptions: [],
      note: "STALE-BINDING-1-PREVIEW",
    };
    const freshResult: EnginePreviewResultUi = {
      engineKey: "revenue.rate-engine",
      available: true,
      lines: [],
      totalMinor: 222,
      currency: "INR",
      appliedExemptions: [],
      note: "FRESH-BINDING-2-PREVIEW",
    };

    // Binding 1's fetch: resolves with the stale result only when the test
    // explicitly lets it through (`settleStale`) -- unless aborted first, in
    // which case (exactly like a real fetch whose AbortController fired) it
    // rejects instead and the late `settleStale` call becomes a no-op, since
    // a promise can only settle once.
    let settleStale: (() => void) | null = null;
    mockPreview.mockImplementationOnce(
      (_input, signal?: AbortSignal) =>
        new Promise<EnginePreviewResultUi>((resolve, reject) => {
          const rejectAborted = () => {
            const err = new Error("The operation was aborted.");
            err.name = "AbortError";
            reject(err);
          };
          if (signal?.aborted) {
            rejectAborted();
            return;
          }
          signal?.addEventListener("abort", rejectAborted);
          settleStale = () => resolve(staleResult);
        }),
    );
    // Binding 2's fetch: resolves normally once fired.
    mockPreview.mockResolvedValueOnce(freshResult);

    // Same "fee or assessment" block family as binding 1 -- the preview panel
    // (and thus previewEngineBinding) only ever fires for those two blocks.
    const binding2: EngineBindingUi = {
      ...binding,
      id: "b2",
      block: "assessment",
      engineKey: "revenue.rate-engine",
    };

    render(<EngineBindingBuilder definitionId="d1" initial={[binding, binding2]} />);

    // Fire binding 1's debounced preview fetch; leave it pending.
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    expect(mockPreview).toHaveBeenCalledTimes(1);

    // Switch to binding 2 before binding 1's fetch resolves -- this is the
    // race. The effect's cleanup aborts binding 1's controller synchronously.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /rate-engine/ }));
    });

    // Fire binding 2's debounced preview fetch; it resolves normally.
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    expect(mockPreview).toHaveBeenCalledTimes(2);
    // Synchronous query, not findByText/waitFor -- those poll via a real
    // setTimeout internally, which never fires once vi.useFakeTimers() has
    // frozen it, hanging until vitest's own test-level timeout. `act` above
    // has already flushed the resolved promise and the resulting re-render.
    expect(screen.getByText("FRESH-BINDING-2-PREVIEW")).toBeInTheDocument();

    // Binding 1's response finally "arrives" late. If cancellation works,
    // its promise already rejected on abort, so this is a no-op.
    await act(async () => {
      settleStale?.();
    });

    expect(screen.queryByText("STALE-BINDING-1-PREVIEW")).not.toBeInTheDocument();
    expect(screen.getByText("FRESH-BINDING-2-PREVIEW")).toBeInTheDocument();

    vi.useRealTimers();
  });
});
