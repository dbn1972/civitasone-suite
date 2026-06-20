# Public Site — Landing Page

**SPRINT:** 3
**ROUTE:** `/` (public, unauthenticated)
**EDITION:** All
**SERVICE OWNER:** theme-service (renders) + content-service (Phase 2 for CMS)

---

## Figma Make prompt

```
Generate the Public Landing Page for CivitasOne Suite.

PURPOSE: Public marketing page for prospects to learn about CivitasOne Suite,
see editions and pricing, request a demo, access docs and status. White-label-able
per deployment (each tenant can theme + reword via theme-service).

LAYOUT: PublicSiteShell

SECTIONS (top to bottom):
1. Top bar
   - Logo (tenant brand or product default)
   - Nav: Product, Editions, Customers, Docs, Status, Sign in (right-aligned)
   - Edition switcher chip (Small Office | PSU | Govt Department)

2. Hero
   - Headline (text.display): "Unified Enterprise Suite — built for Government, PSU, and Small Offices"
   - Subheading (text.body): one-paragraph value proposition
   - Primary CTA: "Request a demo"
   - Secondary CTA: "Read the docs"
   - Hero illustration / product screenshot mosaic
   - Trust strip: 6 customer logos (placeholder, theme-replaceable)

3. Value pillars (3-column grid)
   - Pillar 1: "One platform, all your operations"
   - Pillar 2: "Enterprise-grade security and audit"
   - Pillar 3: "Deploy on AWS or on-premises"
   - Each pillar: icon + heading + 2-sentence body + link

4. Module showcase (tabbed)
   - Tabs: Finance, Procurement, HRMS, Inventory, Projects, CRM, Helpdesk, Reports
   - Each tab: screenshot + 3-bullet feature list + "Learn more" link

5. Edition comparison
   - 3-column table: Small Office | PSU | Govt Department
   - Rows: User count, modules included, support tier, deployment, pricing model
   - Per column: "Talk to sales" CTA

6. Security & compliance strip
   - Badges: ISO 27001, SOC 2, GDPR, IT Act 2000, data residency options
   - Link to security whitepaper

7. Customer story carousel
   - Quote, customer name, role, logo, link to full case study
   - 3 stories rotating

8. Closing CTA
   - Heading: "See CivitasOne in action"
   - Primary: "Request a demo"
   - Secondary: "Self-serve sign up" (only shown for Small Office edition)

9. Footer
   - Columns: Product, Editions, Resources, Company, Legal
   - Bottom row: copyright, language selector, system status pill (links to /status)
   - Legal links: Terms, Privacy, Cookies, Accessibility statement, Trademark policy

STATES:
- Default (light, en-IN)
- Default (dark)
- Mobile (375px) — hero stacks, pillars become accordion, module showcase becomes vertical list
- RTL variant (ar-SA)
- Reduced motion: all parallax / autoplay disabled

ACCESSIBILITY:
- Heading order strictly h1 → h2 → h3
- Hero CTA buttons large + high contrast
- Logos in trust strip have alt text
- Carousel pausable + keyboard navigable
- Skip-to-content link at top

PERFORMANCE TARGETS (Vol 13):
- LCP < 2.5s on 4G mobile
- Hero image lazy-loaded with low-quality placeholder
- No render-blocking third-party scripts

OUT OF SCOPE:
- Blog (Phase 2)
- Live chat widget (Phase 2 — driven by helpdesk-service)
- Cookie consent banner UI (use existing OSS component, link only)
```
