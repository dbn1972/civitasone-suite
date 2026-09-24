import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { ExplainabilityTooltip, type ExplainabilityFactor } from "./ExplainabilityTooltip";

const sampleFactors: ExplainabilityFactor[] = [
  { feature: "daysInStage", contribution: 0.8, direction: "positive" },
  { feature: "interactionCount", contribution: 0.5, direction: "positive" },
  { feature: "lastActivityRecency", contribution: 0.3, direction: "negative" },
];

function renderTooltip(factors: ExplainabilityFactor[] = sampleFactors) {
  return render(
    <ExplainabilityTooltip factors={factors}>
      <button type="button">Trigger</button>
    </ExplainabilityTooltip>
  );
}

describe("ExplainabilityTooltip", () => {
  describe("factor rendering", () => {
    it("renders factor names in tooltip on hover", () => {
      renderTooltip();
      fireEvent.mouseEnter(screen.getByText("Trigger"));
      expect(screen.getByText("daysInStage")).toBeInTheDocument();
      expect(screen.getByText("interactionCount")).toBeInTheDocument();
      expect(screen.getByText("lastActivityRecency")).toBeInTheDocument();
    });

    it("renders contribution bars for each factor", () => {
      const { container } = renderTooltip();
      fireEvent.mouseEnter(screen.getByText("Trigger"));
      const bars = container.querySelectorAll("[role='tooltip'] li");
      expect(bars).toHaveLength(3);
    });

    it("renders positive direction indicator", () => {
      renderTooltip([
        { feature: "testFactor", contribution: 0.5, direction: "positive" },
      ]);
      fireEvent.mouseEnter(screen.getByText("Trigger"));
      expect(
        screen.getByLabelText("testFactor: positive contribution")
      ).toBeInTheDocument();
    });

    it("renders negative direction indicator", () => {
      renderTooltip([
        { feature: "testFactor", contribution: 0.3, direction: "negative" },
      ]);
      fireEvent.mouseEnter(screen.getByText("Trigger"));
      expect(
        screen.getByLabelText("testFactor: negative contribution")
      ).toBeInTheDocument();
    });

    it("applies green color for positive contributions", () => {
      const { container } = renderTooltip([
        { feature: "testFactor", contribution: 0.5, direction: "positive" },
      ]);
      fireEvent.mouseEnter(screen.getByText("Trigger"));
      const barFill = container.querySelector("[role='tooltip'] li .bg-green-500");
      expect(barFill).toBeInTheDocument();
    });

    it("applies red color for negative contributions", () => {
      const { container } = renderTooltip([
        { feature: "testFactor", contribution: 0.3, direction: "negative" },
      ]);
      fireEvent.mouseEnter(screen.getByText("Trigger"));
      const barFill = container.querySelector("[role='tooltip'] li .bg-red-500");
      expect(barFill).toBeInTheDocument();
    });
  });

  describe("keyboard accessibility", () => {
    it("shows tooltip on focus", () => {
      renderTooltip();
      fireEvent.focus(screen.getByText("Trigger"));
      expect(screen.getByRole("tooltip")).toBeInTheDocument();
    });

    it("hides tooltip on blur", () => {
      renderTooltip();
      const trigger = screen.getByText("Trigger");
      fireEvent.focus(trigger);
      expect(screen.getByRole("tooltip")).toBeInTheDocument();
      fireEvent.blur(trigger);
      expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    });

    it("hides tooltip on Escape key", () => {
      renderTooltip();
      fireEvent.focus(screen.getByText("Trigger"));
      expect(screen.getByRole("tooltip")).toBeInTheDocument();
      fireEvent.keyDown(document, { key: "Escape" });
      expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    });
  });

  describe("hover behavior", () => {
    it("shows tooltip on mouse enter", () => {
      renderTooltip();
      fireEvent.mouseEnter(screen.getByText("Trigger"));
      expect(screen.getByRole("tooltip")).toBeInTheDocument();
    });

    it("does not hide the tooltip immediately on mouse leave", () => {
      renderTooltip();
      const trigger = screen.getByText("Trigger");
      fireEvent.mouseEnter(trigger);
      expect(screen.getByRole("tooltip")).toBeInTheDocument();
      fireEvent.mouseLeave(trigger);
      // Still open right after mouseLeave -- see "mouseLeave grace period" below.
      expect(screen.getByRole("tooltip")).toBeInTheDocument();
    });
  });

  // A bare, immediate close on mouseLeave closed the tooltip before the
  // pointer could travel down across the gap into the popover itself -- see
  // ExplainabilityTooltip.tsx.
  describe("mouseLeave grace period", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("hides the tooltip once the grace period elapses without the pointer returning", () => {
      renderTooltip();
      const trigger = screen.getByText("Trigger");
      fireEvent.mouseEnter(trigger);
      fireEvent.mouseLeave(trigger);
      act(() => {
        vi.advanceTimersByTime(300);
      });
      expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    });

    it("cancels the scheduled close if the pointer re-enters the trigger within the grace period", () => {
      renderTooltip();
      const trigger = screen.getByText("Trigger");
      fireEvent.mouseEnter(trigger);
      fireEvent.mouseLeave(trigger);
      act(() => {
        vi.advanceTimersByTime(50);
      });
      fireEvent.mouseEnter(trigger);
      act(() => {
        vi.advanceTimersByTime(300);
      });
      expect(screen.getByRole("tooltip")).toBeInTheDocument();
    });
  });

  describe("empty state", () => {
    it("renders children without wrapper when factors is empty", () => {
      render(
        <ExplainabilityTooltip factors={[]}>
          <button type="button">Trigger</button>
        </ExplainabilityTooltip>
      );
      expect(screen.getByText("Trigger")).toBeInTheDocument();
      fireEvent.focus(screen.getByText("Trigger"));
      expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    });
  });

  describe("tooltip content", () => {
    it("renders 'Key Factors' heading in tooltip", () => {
      renderTooltip();
      fireEvent.mouseEnter(screen.getByText("Trigger"));
      expect(screen.getByText("Key Factors")).toBeInTheDocument();
    });

    it("has accessible factor list", () => {
      renderTooltip();
      fireEvent.mouseEnter(screen.getByText("Trigger"));
      expect(screen.getByLabelText("Factor contributions")).toBeInTheDocument();
    });
  });
});
