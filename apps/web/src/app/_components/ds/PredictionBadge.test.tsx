import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PredictionBadge } from "./PredictionBadge";

describe("PredictionBadge", () => {
  describe("color mapping", () => {
    it("applies green styling for confidence > 0.70", () => {
      const { container } = render(
        <PredictionBadge confidence={0.85} label="85% conversion" />
      );
      const badge = container.querySelector("[role='status']") as HTMLElement;
      expect(badge.className).toContain("bg-green-100");
      expect(badge.className).toContain("text-green-800");
    });

    it("applies amber styling for confidence between 0.40 and 0.70", () => {
      const { container } = render(
        <PredictionBadge confidence={0.55} label="55% conversion" />
      );
      const badge = container.querySelector("[role='status']") as HTMLElement;
      expect(badge.className).toContain("bg-amber-100");
      expect(badge.className).toContain("text-amber-800");
    });

    it("applies amber styling at exactly 0.70", () => {
      const { container } = render(
        <PredictionBadge confidence={0.7} label="70% conversion" />
      );
      const badge = container.querySelector("[role='status']") as HTMLElement;
      expect(badge.className).toContain("bg-amber-100");
    });

    it("applies amber styling at exactly 0.40", () => {
      const { container } = render(
        <PredictionBadge confidence={0.4} label="40% conversion" />
      );
      const badge = container.querySelector("[role='status']") as HTMLElement;
      expect(badge.className).toContain("bg-amber-100");
    });

    it("applies red styling for confidence < 0.40", () => {
      const { container } = render(
        <PredictionBadge confidence={0.2} label="20% conversion" />
      );
      const badge = container.querySelector("[role='status']") as HTMLElement;
      expect(badge.className).toContain("bg-red-100");
      expect(badge.className).toContain("text-red-800");
    });

    it("applies green styling at confidence just above 0.70 (0.71)", () => {
      const { container } = render(
        <PredictionBadge confidence={0.71} label="71% conversion" />
      );
      const badge = container.querySelector("[role='status']") as HTMLElement;
      expect(badge.className).toContain("bg-green-100");
    });

    it("applies red styling at confidence just below 0.40 (0.39)", () => {
      const { container } = render(
        <PredictionBadge confidence={0.39} label="39% conversion" />
      );
      const badge = container.querySelector("[role='status']") as HTMLElement;
      expect(badge.className).toContain("bg-red-100");
    });
  });

  describe("aria-label content", () => {
    it("includes label and confidence level in aria-label", () => {
      render(<PredictionBadge confidence={0.72} label="72% conversion" />);
      const badge = screen.getByRole("status");
      expect(badge).toHaveAttribute(
        "aria-label",
        "72% conversion, high confidence"
      );
    });

    it("includes medium confidence level for mid-range values", () => {
      render(<PredictionBadge confidence={0.55} label="55% breach risk" />);
      const badge = screen.getByRole("status");
      expect(badge).toHaveAttribute(
        "aria-label",
        "55% breach risk, medium confidence"
      );
    });

    it("includes low confidence level for low values", () => {
      render(<PredictionBadge confidence={0.2} label="20% churn" />);
      const badge = screen.getByRole("status");
      expect(badge).toHaveAttribute(
        "aria-label",
        "20% churn, low confidence"
      );
    });

    it("includes fallback indicator in aria-label", () => {
      render(
        <PredictionBadge confidence={0.72} label="72% conversion" isFallback />
      );
      const badge = screen.getByRole("status");
      expect(badge.getAttribute("aria-label")).toContain("fallback model");
    });

    it("includes staleness in aria-label", () => {
      render(
        <PredictionBadge confidence={0.72} label="72% conversion" staleness="3h ago" />
      );
      const badge = screen.getByRole("status");
      expect(badge.getAttribute("aria-label")).toContain("predicted 3h ago");
    });
  });

  describe("keyboard focus behavior", () => {
    it("is focusable via tabIndex", () => {
      const { container } = render(
        <PredictionBadge confidence={0.72} label="72% conversion" />
      );
      const badge = container.querySelector("[role='status']") as HTMLElement;
      expect(badge).toHaveAttribute("tabindex", "0");
    });

    it("has focus ring styles", () => {
      const { container } = render(
        <PredictionBadge confidence={0.72} label="72% conversion" />
      );
      const badge = container.querySelector("[role='status']") as HTMLElement;
      expect(badge.className).toContain("focus:ring-2");
    });

    it("shows tooltip on focus when factors are provided", () => {
      const factors = [
        { feature: "daysInStage", contribution: 0.8, direction: "positive" as const },
      ];
      const { container } = render(
        <PredictionBadge confidence={0.72} label="72% conversion" factors={factors} />
      );
      const badge = container.querySelector("[role='status']") as HTMLElement;
      fireEvent.focus(badge);
      expect(screen.getByRole("tooltip")).toBeInTheDocument();
    });
  });

  describe("fallback and staleness display", () => {
    it("renders fallback indicator when isFallback is true", () => {
      render(
        <PredictionBadge confidence={0.72} label="72% conversion" isFallback />
      );
      expect(screen.getByTitle("Fallback model used")).toBeInTheDocument();
    });

    it("does not render fallback indicator when isFallback is false", () => {
      render(
        <PredictionBadge confidence={0.72} label="72% conversion" isFallback={false} />
      );
      expect(screen.queryByTitle("Fallback model used")).not.toBeInTheDocument();
    });

    it("renders staleness text when provided", () => {
      render(
        <PredictionBadge confidence={0.72} label="72% conversion" staleness="3h ago" />
      );
      expect(screen.getByText("3h ago")).toBeInTheDocument();
    });

    it("does not render staleness text when not provided", () => {
      render(
        <PredictionBadge confidence={0.72} label="72% conversion" />
      );
      expect(screen.queryByText(/ago/)).not.toBeInTheDocument();
    });
  });

  describe("label display", () => {
    it("renders the label text", () => {
      render(<PredictionBadge confidence={0.72} label="72% conversion" />);
      expect(screen.getByText("72% conversion")).toBeInTheDocument();
    });
  });
});
