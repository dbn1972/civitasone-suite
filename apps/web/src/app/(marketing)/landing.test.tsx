import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import LandingPage from "./page";
import PricingPage from "./pricing/page";
import SandboxPage from "./sandbox/page";
import MarketingLayout from "./layout";

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
    expect(screen.getByText("Zero Cost")).toBeInTheDocument();
  });

  it("renders the comparison table", () => {
    render(<LandingPage />);
    const table = document.querySelector('[data-testid="comparison-table"]');
    expect(table).toBeInTheDocument();
    expect(screen.getByText("CivitasOne")).toBeInTheDocument();
    expect(screen.getByText("SAP")).toBeInTheDocument();
    expect(screen.getByText("Oracle")).toBeInTheDocument();
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
    const pricingLink = screen.getByRole("link", { name: /View Pricing/i });
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
