import { describe, it, expect } from "vitest";
import { render as rtlRender, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import axe from "axe-core";
import enMessages from "@/messages/en.json";
import hiMessages from "@/messages/hi.json";
import { GoalsProgressRing, type CategoryScore } from "./GoalsProgressRing";

const CATEGORIES: CategoryScore[] = [
  { label: "Individual", total: 4, achieved: 2, color: "var(--info)" },
  { label: "Team", total: 2, achieved: 2, color: "var(--good)" },
];

function renderRing(locale: "en" | "hi" = "en") {
  const messages = locale === "en" ? enMessages : hiMessages;
  return rtlRender(
    <NextIntlClientProvider locale={locale} messages={messages}>
      <GoalsProgressRing categories={CATEGORIES} overallScore={50} />
    </NextIntlClientProvider>,
  );
}

// GAP-HR-GOALS-05 acceptance 1: "axe: no svg-img-alt violations on GoalsProgressRing".
describe("GoalsProgressRing accessibility (GAP-HR-GOALS-05)", () => {
  it("exposes every ring svg as an image with a name that carries the percentage", () => {
    renderRing();
    const rings = screen.getAllByRole("img");
    expect(rings.map((r) => r.getAttribute("aria-label"))).toEqual(["Overall: 50%", "Individual: 50%", "Team: 100%"]);
  });

  it("hides the in-svg numbers from assistive tech (the label already says them)", () => {
    const { container } = renderRing();
    const texts = container.querySelectorAll("svg text");
    expect(texts.length).toBeGreaterThan(0);
    for (const t of Array.from(texts)) expect(t).toHaveAttribute("aria-hidden", "true");
  });

  it("passes axe's svg-img-alt rule", async () => {
    const { container } = renderRing();
    const results = await axe.run(container, { runOnly: { type: "rule", values: ["svg-img-alt"] } });
    expect(results.violations).toEqual([]);
    // The rule must actually have examined the rings, not passed vacuously.
    expect(results.passes.flatMap((p) => p.nodes).length).toBeGreaterThanOrEqual(3);
  });

  it("names the rings in Hindi when the locale is hi", () => {
    renderRing("hi");
    expect(screen.getAllByRole("img")[0]).toHaveAttribute("aria-label", "कुल: 50%");
    expect(screen.getByText("2/4 लक्ष्य")).toBeInTheDocument();
  });
});
