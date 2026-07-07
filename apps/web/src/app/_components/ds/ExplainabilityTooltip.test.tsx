import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
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

    it("hides tooltip on mouse leave", () => {
      renderTooltip();
      const trigger = screen.getByText("Trigger");
      fireEvent.mouseEnter(trigger);
      expect(screen.getByRole("tooltip")).toBeInTheDocument();
      fireEvent.mouseLeave(trigger);
      expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
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
