import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, act } from "@testing-library/react";
import { KeyboardShortcuts } from "./KeyboardShortcuts";

const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

// Two-key chord: press the mode key, then the action key.
function chord(mode: string, action: string) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: mode }));
  });
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: action }));
  });
}

beforeEach(() => {
  mockPush.mockReset();
});

describe("KeyboardShortcuts chords", () => {
  it("'n v' navigates to the real voucher-creation route", () => {
    render(<KeyboardShortcuts />);
    chord("n", "v");
    expect(mockPush).toHaveBeenCalledWith("/finance/accounting/vouchers/new");
  });

  it("'n l' navigates to the real leave-application route", () => {
    render(<KeyboardShortcuts />);
    chord("n", "l");
    expect(mockPush).toHaveBeenCalledWith("/hr/leave/apply");
  });

  // Fails-before / passes-after: the two "new" actions used to push routes that
  // 404 (/finance/vouchers/new, /hr/leave/new).
  it("never pushes a known dead route", () => {
    render(<KeyboardShortcuts />);
    chord("n", "v");
    chord("n", "l");
    expect(mockPush).not.toHaveBeenCalledWith("/finance/vouchers/new");
    expect(mockPush).not.toHaveBeenCalledWith("/hr/leave/new");
  });
});
