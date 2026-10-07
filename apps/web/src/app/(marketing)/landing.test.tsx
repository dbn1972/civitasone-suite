import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import LandingPage from "./page";
import PricingPage from "./pricing/page";
import SandboxPage from "./sandbox/page";
import MarketingLayout from "./layout";
import { MODULE_COUNT } from "@/app/_data/moduleRegistry";
import { chapters } from "./docs/_content/chapters";

describe("Marketing Landing Page", () => {
  it("renders the hero headline", () => {
    render(<LandingPage />);
    expect(
      screen.getByRole("heading", { name: /The ERP that works without internet/i })
    ).toBeInTheDocument();
  });

  it("renders the hero subheadline", () => {
    render(<LandingPage />);
    expect(
      screen.getByText(/Built for Indian Government, PSU, and Small Offices/i)
    ).toBeInTheDocument();
  });

  it("renders feature grid with 9 features", () => {
    render(<LandingPage />);
    const grid = document.querySelector('[data-testid="feature-grid"]');
    expect(grid).toBeInTheDocument();
    // Each feature card has an h3
    const featureHeadings = grid!.querySelectorAll("h3");
    expect(featureHeadings).toHaveLength(9);
  });

  it("renders all feature titles", () => {
    render(<LandingPage />);
    expect(screen.getByText("Offline-First")).toBeInTheDocument();
    expect(screen.getByText("5 Languages")).toBeInTheDocument();
    expect(screen.getByText("Modular")).toBeInTheDocument();
    expect(screen.getByText("Secure")).toBeInTheDocument();
    expect(screen.getByText("Mobile-First")).toBeInTheDocument();
    expect(screen.getByText("AI Assistant")).toBeInTheDocument();
    expect(screen.getByText("Sub-Second")).toBeInTheDocument();
    expect(screen.getByText("Extensible")).toBeInTheDocument();
    // GAP-DASHBOARD-HOME-03: "Zero Cost" (implied all editions free) is now
    // "Open-source core" (true only of the Small Office edition).
    expect(screen.getByText("Open-source core")).toBeInTheDocument();
    expect(screen.queryByText("Zero Cost")).not.toBeInTheDocument();
  });

  it("renders the comparison table", () => {
    render(<LandingPage />);
    const table = document.querySelector('[data-testid="comparison-table"]');
    expect(table).toBeInTheDocument();
    expect(screen.getByText("CivitasOne")).toBeInTheDocument();
    expect(screen.getByText("SAP")).toBeInTheDocument();
    expect(screen.getByText("Oracle")).toBeInTheDocument();
  });

  // GAP-DASHBOARD-HOME-01: the hero card is static copy, not a live feed. It
  // must not pose as "Live System Stats" with a status dot, and its numbers
  // must be derived, not fabricated.
  it("GAP-DASHBOARD-HOME-01: hero card has no 'Live' wording and shows the registry module count", () => {
    render(<LandingPage />);
    expect(screen.queryByText(/Live System Stats/i)).not.toBeInTheDocument();
    expect(screen.getByText("At a glance")).toBeInTheDocument();
    expect(screen.getByTestId("stat-modules")).toHaveTextContent(String(MODULE_COUNT));
    // The fabricated "80%+ test coverage" claim is gone.
    expect(screen.queryByText(/test coverage/i)).not.toBeInTheDocument();
  });

  // GAP-DASHBOARD-HOME-02: no unsourced competitor pricing/training numbers,
  // and no "no contest" copy.
  it("GAP-DASHBOARD-HOME-02: comparison table carries no unsourced competitor numbers", () => {
    render(<LandingPage />);
    expect(screen.queryByText(/₹50L/)).not.toBeInTheDocument();
    expect(screen.queryByText(/₹30L/)).not.toBeInTheDocument();
    expect(screen.queryByText(/40\+ hours/)).not.toBeInTheDocument();
    expect(screen.queryByText(/no contest/i)).not.toBeInTheDocument();
  });

  // GAP-DASHBOARD-HOME-03: no unqualified ₹0 claim; CTA relabelled.
  it("GAP-DASHBOARD-HOME-03: ₹0 claim is qualified and the hero CTA says 'See editions'", () => {
    render(<LandingPage />);
    expect(
      screen.getByText(/₹0 licensing for Small Office \(open source\)/i)
    ).toBeInTheDocument();
    const cta = screen.getByRole("link", { name: /See editions/i });
    expect(cta).toHaveAttribute("href", "/pricing");
    expect(screen.queryByRole("link", { name: /^View Pricing$/i })).not.toBeInTheDocument();
  });

  it("renders modules showcase strip", () => {
    render(<LandingPage />);
    const strip = document.querySelector('[data-testid="modules-strip"]');
    expect(strip).toBeInTheDocument();
    expect(screen.getByText("Finance")).toBeInTheDocument();
    expect(screen.getByText("HR")).toBeInTheDocument();
    // "Procurement" appears in both modules strip and sandbox roles section
    expect(screen.getAllByText("Procurement").length).toBeGreaterThanOrEqual(1);
  });

  // GAP-DASHBOARD-HOME-04: every "Learn more" link must resolve to a real
  // /docs/<slug> chapter page (the old /#<name> anchors matched no id).
  it("GAP-DASHBOARD-HOME-04: every 'Learn more' link resolves to an existing docs chapter", () => {
    render(<LandingPage />);
    const chapterSlugs = new Set(chapters.map((c) => c.slug));
    const learnMore = screen.getAllByRole("link", { name: /Learn more/i });
    expect(learnMore.length).toBeGreaterThan(0);
    for (const link of learnMore) {
      const href = link.getAttribute("href") ?? "";
      expect(href.startsWith("/docs/")).toBe(true);
      expect(href).not.toContain(" ");
      const slug = href.replace("/docs/", "");
      expect(chapterSlugs.has(slug)).toBe(true);
    }
  });

  // GAP-DASHBOARD-HOME-05: role chips are keyboard-focusable links into the
  // sandbox, not dead <span>s styled like buttons.
  it("GAP-DASHBOARD-HOME-05: role chips are links to the sandbox", () => {
    render(<LandingPage />);
    const chips = document.querySelector('[data-testid="role-chips"]');
    expect(chips).toBeInTheDocument();
    const links = chips!.querySelectorAll("a");
    expect(links.length).toBe(6);
    links.forEach((link) => expect(link.getAttribute("href")).toBe("/sandbox"));
  });

  // GAP-DASHBOARD-HOME-06: the dead PDF download link is gone; the online docs
  // link remains.
  it("GAP-DASHBOARD-HOME-06: no dead PDF download link on the landing page", () => {
    const { container } = render(<LandingPage />);
    expect(container.querySelector('a[href="/docs/CivitasOne-User-Manual.pdf"]')).toBeNull();
    expect(screen.getByRole("link", { name: /Read Online/i })).toHaveAttribute("href", "/docs");
  });

  it("renders trust bar badges", () => {
    render(<LandingPage />);
    expect(screen.getByText("Government of India")).toBeInTheDocument();
    expect(screen.getByText("DPDP Act")).toBeInTheDocument();
    expect(screen.getByText("GFR 2017")).toBeInTheDocument();
  });

  it("renders CTA links pointing to sandbox and pricing", () => {
    render(<LandingPage />);
    const sandboxLink = screen.getByRole("link", { name: /Try the Sandbox/i });
    expect(sandboxLink).toHaveAttribute("href", "/sandbox");
    const pricingLink = screen.getByRole("link", { name: /See editions/i });
    expect(pricingLink).toHaveAttribute("href", "/pricing");
  });
});

describe("Pricing Page", () => {
  it("renders 3 plan cards", () => {
    render(<PricingPage />);
    const cards = document.querySelector('[data-testid="pricing-cards"]');
    expect(cards).toBeInTheDocument();
    expect(screen.getByText("Small Office")).toBeInTheDocument();
    expect(screen.getByText("PSU")).toBeInTheDocument();
    expect(screen.getByText("Government Department")).toBeInTheDocument();
  });

  it("renders pricing for each plan", () => {
    render(<PricingPage />);
    expect(screen.getByText("₹0/month")).toBeInTheDocument();
    expect(screen.getByText("₹15,000/month")).toBeInTheDocument();
    expect(screen.getByText("Custom pricing")).toBeInTheDocument();
  });

  it("renders FAQ section with 8 questions", () => {
    render(<PricingPage />);
    const faq = document.querySelector('[data-testid="pricing-faq"]');
    expect(faq).toBeInTheDocument();
    const dts = faq!.querySelectorAll("dt");
    expect(dts).toHaveLength(8);
  });

  it("renders CTA buttons for each plan", () => {
    render(<PricingPage />);
    expect(screen.getByRole("link", { name: "Download" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Start Free Trial" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Contact Sales" })).toBeInTheDocument();
  });
});

describe("Sandbox Page", () => {
  it("renders 7 role cards", () => {
    render(<SandboxPage />);
    const roles = document.querySelector('[data-testid="sandbox-roles"]');
    expect(roles).toBeInTheDocument();
    const links = roles!.querySelectorAll("a");
    expect(links).toHaveLength(7);
  });

  it("renders all role names", () => {
    render(<SandboxPage />);
    expect(screen.getByText("Office Head")).toBeInTheDocument();
    expect(screen.getByText("Finance Clerk")).toBeInTheDocument();
    expect(screen.getByText("HR Officer")).toBeInTheDocument();
    expect(screen.getByText("Procurement")).toBeInTheDocument();
    expect(screen.getByText("Small Business")).toBeInTheDocument();
    expect(screen.getByText("Citizen")).toBeInTheDocument();
    expect(screen.getByText("Admin")).toBeInTheDocument();
  });

  it("renders demo mode badge", () => {
    render(<SandboxPage />);
    expect(screen.getByText("Demo Mode")).toBeInTheDocument();
  });

  it("renders the heading", () => {
    render(<SandboxPage />);
    expect(
      screen.getByRole("heading", { name: /Try CivitasOne — No Sign-Up Required/i })
    ).toBeInTheDocument();
  });

  it("renders the disclaimer text", () => {
    render(<SandboxPage />);
    expect(
      screen.getByText(/Data is fictional.*No real emails or payments are sent/i)
    ).toBeInTheDocument();
  });

  it("role cards link to dashboard", () => {
    render(<SandboxPage />);
    const roles = document.querySelector('[data-testid="sandbox-roles"]');
    const links = roles!.querySelectorAll("a");
    links.forEach((link) => {
      expect(link.getAttribute("href")).toBe("/dashboard");
    });
  });
});

describe("Marketing Layout", () => {
  it("renders nav with logo", () => {
    render(
      <MarketingLayout>
        <div>Content</div>
      </MarketingLayout>
    );
    // Logo appears in both header and footer
    expect(screen.getAllByText("◈").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("CivitasOne").length).toBeGreaterThan(0);
  });

  it("renders nav links", () => {
    render(
      <MarketingLayout>
        <div>Content</div>
      </MarketingLayout>
    );
    // Pricing appears in both nav and footer, so use getAllByRole
    const pricingLinks = screen.getAllByRole("link", { name: /Pricing/i });
    expect(pricingLinks.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole("link", { name: /Try Sandbox/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Sign In/i })).toBeInTheDocument();
  });

  it("renders footer with copyright", () => {
    render(
      <MarketingLayout>
        <div>Content</div>
      </MarketingLayout>
    );
    expect(screen.getByText(/© 2026 CivitasOne/i)).toBeInTheDocument();
  });

  it("renders Made in India text", () => {
    render(
      <MarketingLayout>
        <div>Content</div>
      </MarketingLayout>
    );
    expect(screen.getByText(/Made in India 🇮🇳 for India/i)).toBeInTheDocument();
  });

  it("wraps children in a main element", () => {
    render(
      <MarketingLayout>
        <div data-testid="child">Hello</div>
      </MarketingLayout>
    );
    const main = document.querySelector("main#main");
    expect(main).toBeInTheDocument();
    expect(screen.getByTestId("child")).toBeInTheDocument();
  });
});
