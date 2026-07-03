import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { ActivationTracker } from "./ActivationTracker";

const mockTrackActivation = vi.fn();
vi.mock("@/lib/activation", () => ({
  trackActivation: (...args: unknown[]) => mockTrackActivation(...args),
}));

describe("ActivationTracker", () => {
  beforeEach(() => {
    mockTrackActivation.mockClear();
    sessionStorage.clear();
  });

  it("renders nothing (invisible component)", () => {
    const { container } = render(<ActivationTracker steps={["signin"]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("calls trackActivation for each step", () => {
    render(<ActivationTracker steps={["signin", "wizard_opened"]} />);
    expect(mockTrackActivation).toHaveBeenCalledWith("signin");
    expect(mockTrackActivation).toHaveBeenCalledWith("wizard_opened");
  });

  it("deduplicates via sessionStorage on re-mount", () => {
    render(<ActivationTracker steps={["signin"]} />);
    expect(mockTrackActivation).toHaveBeenCalledTimes(1);
    mockTrackActivation.mockClear();
    render(<ActivationTracker steps={["signin"]} />);
    // sessionStorage key set from first mount prevents re-emit
    expect(mockTrackActivation).not.toHaveBeenCalled();
  });

  it("stores session key per step", () => {
    render(<ActivationTracker steps={["signin"]} />);
    expect(sessionStorage.getItem("civitasone.activation.signin")).toBe("1");
  });
});
