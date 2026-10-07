import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import PricingPage from "./page";
import LandingPage from "../page";
import ContactPage from "../contact/page";

/**
 * Covers pricing batch1 gaps HOME-01..07. Each assertion encodes the NEW
 * behaviour and would fail against the pre-fix source.
 */

describe("GAP-PRICING-HOME-01 — PSU CTA resolves to a real route", () => {
  it("PSU CTA points at /contact?plan=psu, not /auth/register", () => {
    render(<PricingPage />);
    const cta = screen.getByRole("link", { name: "Request a demo" });
    expect(cta).toHaveAttribute("href", "/contact?plan=psu");
  });

  it("no CTA points at the non-existent /auth/register route", () => {
    render(<PricingPage />);
    const links = screen.getAllByRole("link");
    for (const link of links) {
      expect(link.getAttribute("href") ?? "").not.toMatch(/\/auth\/register/);
    }
  });

  it("every pricing CTA href is a known-good target (no 404 routes)", () => {
    render(<PricingPage />);
    const allowed = [
      "https://github.com/civitasone",
      "/contact?plan=psu",
      "/contact?plan=government",
    ];
    const cards = document.querySelector('[data-testid="pricing-cards"]')!;
    const ctas = within(cards as HTMLElement).getAllByRole("link");
    for (const cta of ctas) {
      expect(allowed).toContain(cta.getAttribute("href"));
    }
  });
});

describe("GAP-PRICING-HOME-02 — compliance claim is qualified", () => {
  it("FAQ no longer asserts compliance as fact", () => {
    render(<PricingPage />);
    expect(
      screen.queryByText(/built to meet GFR 2017 procurement norms/i)
    ).not.toBeInTheDocument();
  });

  it("FAQ uses 'designed to support' and offers status on request", () => {
    render(<PricingPage />);
    expect(screen.getByText(/designed to support GFR 2017/i)).toBeInTheDocument();
    expect(screen.getByText(/available on request/i)).toBeInTheDocument();
  });
});

describe("GAP-PRICING-HOME-03 — landing and pricing agree per edition", () => {
  it("landing hero qualifies ₹0 licensing to Small Office", () => {
    render(<LandingPage />);
    expect(screen.getByText(/₹0 licensing for Small Office/i)).toBeInTheDocument();
  });

  it("pricing still shows the PSU price", () => {
    render(<PricingPage />);
    expect(screen.getByText("₹15,000/month")).toBeInTheDocument();
  });
});

describe("GAP-PRICING-HOME-04 — module count and support are not conflated", () => {
  it("does not render the conflated 'All 33 + dedicated support' string", () => {
    render(<PricingPage />);
    expect(screen.queryByText(/All 33 \+ dedicated support/i)).not.toBeInTheDocument();
  });

  it("renders module count separately from support tier", () => {
    render(<PricingPage />);
    expect(screen.getAllByText(/All 33 modules/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/Dedicated CSM \+ dedicated support/i)).toBeInTheDocument();
  });
});

describe("GAP-PRICING-HOME-06 — no bare dash values; annual claim backed", () => {
  it("does not render a bare 'SLA: —' value", () => {
    render(<PricingPage />);
    expect(screen.queryByText(/SLA:\s*—/)).not.toBeInTheDocument();
  });

  it("Small Office SLA row is explicit, not a dash", () => {
    render(<PricingPage />);
    expect(screen.getByText(/SLA: none \(community\)/i)).toBeInTheDocument();
  });

  it("annual billing claim shows the actual annual figure", () => {
    render(<PricingPage />);
    expect(screen.getByText(/₹1,53,000\/year/i)).toBeInTheDocument();
  });
});

describe("GAP-PRICING-HOME-07 — a11y of plan feature list", () => {
  it("marks every ✓ decorative glyph aria-hidden", () => {
    render(<PricingPage />);
    const cards = document.querySelector('[data-testid="pricing-cards"]')!;
    const checks = Array.from(cards.querySelectorAll("span")).filter(
      (s) => s.textContent === "✓"
    );
    expect(checks.length).toBeGreaterThan(0);
    for (const c of checks) {
      expect(c).toHaveAttribute("aria-hidden", "true");
    }
  });

  it("renders a Most Popular badge that is clip-safe (truncate + max width)", () => {
    render(<PricingPage />);
    const badge = screen.getByTestId("popular-badge");
    expect(badge).toBeInTheDocument();
    expect(badge.className).toMatch(/truncate/);
    expect(badge.className).toMatch(/max-w-\[calc\(100%-3rem\)\]/);
  });
});

describe("GAP-PRICING-HOME-01 — contact page prefills the selected plan", () => {
  it("shows the PSU interest notice when ?plan=psu", async () => {
    const ui = await ContactPage({ searchParams: Promise.resolve({ plan: "psu" }) });
    render(ui);
    const notice = screen.getByTestId("contact-plan-interest");
    expect(within(notice).getAllByText(/PSU edition/i).length).toBeGreaterThanOrEqual(1);
  });

  it("shows no interest notice without a plan param", async () => {
    const ui = await ContactPage({ searchParams: Promise.resolve({}) });
    render(ui);
    expect(screen.queryByTestId("contact-plan-interest")).not.toBeInTheDocument();
  });

  it("ignores unknown plan values (no reflected injection)", async () => {
    const ui = await ContactPage({
      searchParams: Promise.resolve({ plan: "<script>" }),
    });
    render(ui);
    expect(screen.queryByTestId("contact-plan-interest")).not.toBeInTheDocument();
  });
});
