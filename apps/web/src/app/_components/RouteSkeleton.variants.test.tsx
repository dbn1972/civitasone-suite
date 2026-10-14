import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import hiMessages from "@/messages/hi.json";
import { RouteSkeleton, type RouteSkeletonVariant } from "./RouteSkeleton";

// SF-11: every variant is token-based, announced once as a polite status
// region with a localised "Loading" label, and busy for assistive tech.
const VARIANTS: RouteSkeletonVariant[] = ["list", "table", "tiles", "hub", "dashboard", "form", "detail"];

describe("RouteSkeleton variants (SF-11)", () => {
  it.each(VARIANTS)("%s: one polite status region, aria-busy, sr-only label, no hex/slate", (variant) => {
    const { container } = render(<RouteSkeleton variant={variant} />);
    const status = screen.getAllByRole("status");
    expect(status).toHaveLength(1);
    expect(status[0]).toHaveAttribute("aria-busy", "true");
    expect(status[0]).toHaveAttribute("aria-live", "polite");
    expect(container.querySelector(".sr-only")?.textContent).toBe("Loading…");
    expect(container.innerHTML).not.toMatch(/#[0-9a-fA-F]{3,8}\b|bg-slate-|bg-gray-/);
    expect(container.innerHTML).toContain("var(--line");
  });

  it("stats prop sets the number of stat cards", () => {
    const { container } = render(<RouteSkeleton variant="dashboard" stats={2} />);
    expect(container.querySelector('div[style*="repeat(2, 1fr)"]')).not.toBeNull();
  });

  it("announces the Hindi label under the hi locale", () => {
    render(
      <NextIntlClientProvider locale="hi" messages={hiMessages}>
        <RouteSkeleton variant="form" />
      </NextIntlClientProvider>,
    );
    expect(screen.getByRole("status")).toHaveAttribute("aria-label", hiMessages.msg.loading);
  });

  it("announces the English label under the en locale", () => {
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <RouteSkeleton />
      </NextIntlClientProvider>,
    );
    expect(screen.getByRole("status")).toHaveAttribute("aria-label", enMessages.msg.loading);
  });
});

describe(".skeleton CSS rule (SF-11)", () => {
  const css = readFileSync(join(__dirname, "..", "civitas-ds.css"), "utf8");
  it("defines the shimmer rule with tokens only, a dark variant and reduced motion", () => {
    expect(css).toMatch(/\.skeleton\{[^}]*animation:sk-shimmer/);
    expect(css).toMatch(/\.skeleton\{[^}]*var\(--line2\)/);
    expect(css).toMatch(/\.dark \.skeleton\{/);
    expect(css).toMatch(/@media \(prefers-reduced-motion:reduce\)\{\s*\.skeleton\{animation:none/);
    const rule = css.slice(css.indexOf(".skeleton{"), css.indexOf("@media (prefers-reduced-motion:reduce){\n  .skeleton"));
    expect(rule).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});
