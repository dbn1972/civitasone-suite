import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import MarketingLayout from "../layout";
import ContactPage from "./page";

describe("Marketing header — Contact navigation (GAP-CONTACT-HOME-04)", () => {
  it("shows a Contact link in the header pointing to /contact", () => {
    render(
      <MarketingLayout>
        <div>content</div>
      </MarketingLayout>,
    );
    const contactLinks = screen
      .getAllByRole("link", { name: /^Contact$/ })
      .filter((l) => l.getAttribute("href") === "/contact");
    expect(contactLinks.length).toBeGreaterThanOrEqual(1);
  });

  it("exposes a Contact sales CTA in the header", () => {
    render(
      <MarketingLayout>
        <div>content</div>
      </MarketingLayout>,
    );
    const cta = screen.getByRole("link", { name: /Contact sales/i });
    expect(cta).toHaveAttribute("href", "/contact");
  });

  it("has a mobile menu button that discloses nav links including Contact", () => {
    render(
      <MarketingLayout>
        <div>content</div>
      </MarketingLayout>,
    );
    const toggle = screen.getByRole("button", { name: /toggle navigation menu/i });
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");

    const panel = document.getElementById("mobile-nav-panel");
    expect(panel).toBeInTheDocument();
    const links = within(panel!).getAllByRole("link");
    const hrefs = links.map((l) => l.getAttribute("href"));
    expect(hrefs).toContain("/contact");
    expect(hrefs).toContain("/pricing");
  });

  it("keeps the existing primary CTAs working", () => {
    render(
      <MarketingLayout>
        <div>content</div>
      </MarketingLayout>,
    );
    expect(screen.getByRole("link", { name: /Try Sandbox/i })).toHaveAttribute("href", "/sandbox");
    expect(screen.getByRole("link", { name: /Sign In/i })).toHaveAttribute("href", "/auth/login");
  });
});

describe("Contact page content (GAP-CONTACT-HOME-01/02/03)", () => {
  it("renders the enquiry form (no email client required)", async () => {
    render(await ContactPage({}));
    expect(screen.getByRole("button", { name: /send message/i })).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toBeInTheDocument();
  });

  it("states a response-time commitment (SLA)", async () => {
    render(await ContactPage({}));
    expect(screen.getByText(/respond to enquiries within 3 business days/i)).toBeInTheDocument();
  });

  it("uses a distinct address per channel — no duplicated inbox (GAP-02)", async () => {
    render(await ContactPage({}));
    const emails = screen
      .getAllByRole("link")
      .map((l) => l.getAttribute("href"))
      .filter((h): h is string => !!h && h.startsWith("mailto:"));
    const unique = new Set(emails);
    // sales@, info@, security@ — all distinct.
    expect(unique.size).toBe(emails.length);
    expect(emails).toContain("mailto:sales@civitasone.app");
    expect(emails).toContain("mailto:info@civitasone.app");
    expect(emails).toContain("mailto:security@civitasone.app");
  });

  it("reworks the security card: private reporting, ack SLA, and a security.txt link (GAP-03)", async () => {
    render(await ContactPage({}));
    expect(screen.getByText(/report it privately/i)).toBeInTheDocument();
    expect(screen.getByText(/acknowledge security reports within 2 business days/i)).toBeInTheDocument();
    const txt = screen.getByRole("link", { name: /security\.txt/i });
    expect(txt).toHaveAttribute("href", "/.well-known/security.txt");
    // The misleading "do not open a public issue" absolutist line is gone.
    expect(screen.queryByText(/Please do not open a public issue\./)).toBeNull();
  });
});
