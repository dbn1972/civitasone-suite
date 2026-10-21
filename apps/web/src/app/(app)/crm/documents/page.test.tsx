import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderWithIntl } from "@/lib/testUtils/intl";
import { render as rtlRender, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

function render(ui: ReactElement) {
  return rtlRender(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {ui}
    </NextIntlClientProvider>,
  );
}
import Page from "./page";
import * as rg from "@/lib/auth/roleGuard";

// GAP-CRM-DOCUMENTS-03: stamp every next/link so the test can tell a client-side
// <Link> from a plain <a href> (which the href-only assertions cannot).
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} data-next-link="true" {...rest}>
      {children}
    </a>
  ),
}));
import * as docs from "@/lib/crm/documents";

// Gate the Manage Document Types control on CRM admin roles
// (GAP-CRM-DOCUMENTS-01). The page is a server component; mock only the
// session-role read so we can render it under jsdom.
vi.mock("@/lib/auth/roleGuard", async (orig) => {
  const actual = await orig<typeof import("@/lib/auth/roleGuard")>();
  return { ...actual, getSessionRoles: vi.fn() };
});

// GAP-CRM-DOCUMENTS-02: the register fetches on mount; stub it so the page
// renders deterministically under jsdom.
vi.mock("@/lib/crm/documents", async (orig) => {
  const actual = await orig<typeof import("@/lib/crm/documents")>();
  return { ...actual, getDocumentRegister: vi.fn() };
});

beforeEach(() => {
  vi.mocked(rg.getSessionRoles).mockReset();
  vi.mocked(docs.getDocumentRegister).mockResolvedValue({ rows: [], total: 0, source: "api" });
});

describe("CRM Documents landing (GAP-CRM-DOCUMENTS-01)", () => {
  it("shows the Manage Document Types button to a CRM admin", () => {
    vi.mocked(rg.getSessionRoles).mockReturnValue(["crm_admin"]);
    renderWithIntl(<Page />);
    expect(screen.getByRole("link", { name: /manage document types/i })).toBeInTheDocument();
  });

  it("hides the button and tells a clerk to ask an admin", () => {
    vi.mocked(rg.getSessionRoles).mockReturnValue(["crm_user"]);
    renderWithIntl(<Page />);
    expect(screen.queryByRole("link", { name: /manage document types/i })).not.toBeInTheDocument();
    expect(screen.getByText(/ask a crm administrator to change document types/i)).toBeInTheDocument();
  });
});

describe("CRM Documents cross-record register (GAP-CRM-DOCUMENTS-02)", () => {
  it("renders the register with its filter controls", () => {
    vi.mocked(rg.getSessionRoles).mockReturnValue(["crm_admin"]);
    renderWithIntl(<Page />);
    // The register heading and its view/record-type/scan-status filters exist.
    expect(screen.getByRole("heading", { name: /document register/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/register view/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/record type/i)).toBeInTheDocument();
  });

  // GAP-CRM-DOCUMENTS-02 acceptance: "Failed load shows error state, not empty table". An outage
  // must not read as "No documents match" (a register with nothing in it).
  it("shows a retry error state, not the empty-register copy, when the register fails to load", async () => {
    vi.mocked(rg.getSessionRoles).mockReturnValue(["crm_admin"]);
    vi.mocked(docs.getDocumentRegister).mockResolvedValue({ rows: [], total: 0, source: "error" });
    renderWithIntl(<Page />);
    expect(await screen.findByRole("button", { name: /try again/i })).toBeInTheDocument();
    expect(screen.queryByText("No documents match")).not.toBeInTheDocument();
  });

  it("shows the empty-register copy for a register that loaded fine and has nothing in it", async () => {
    vi.mocked(rg.getSessionRoles).mockReturnValue(["crm_admin"]);
    renderWithIntl(<Page />);
    expect(await screen.findByText("No documents match")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /try again/i })).not.toBeInTheDocument();
  });
});

describe("CRM Documents client-side navigation (GAP-CRM-DOCUMENTS-03)", () => {
  it("links to Accounts/Contacts/Document Types via in-app links with correct hrefs", () => {
    vi.mocked(rg.getSessionRoles).mockReturnValue(["crm_admin"]);
    render(<Page />);
    expect(screen.getByRole("link", { name: /go to accounts/i })).toHaveAttribute("href", "/crm/accounts");
    expect(screen.getByRole("link", { name: /go to contacts/i })).toHaveAttribute("href", "/crm/contacts");
    expect(screen.getByRole("link", { name: /manage document types/i })).toHaveAttribute("href", "/crm/document-types");
  });

  it("renders every internal CRM link through next/link (client-side navigation), never a plain anchor", () => {
    vi.mocked(rg.getSessionRoles).mockReturnValue(["crm_admin"]);
    render(<Page />);
    // The next/link mock above stamps data-next-link on every <Link>. A plain
    // <a href> to an internal route would lack it and force a full page load.
    // The scope is the landing card (the register rows are a separate component).
    const card = screen.getByText(/where documents live/i).closest(".card") as HTMLElement;
    const internal = Array.from(card.querySelectorAll("a[href^='/crm/']"));
    // Go to Accounts, Go to Contacts, Manage Document Types, plus the
    // "configure types" rich-text link inside the guidance list.
    expect(internal.length).toBeGreaterThanOrEqual(4);
    for (const a of internal) {
      expect(a, `plain <a href=${a.getAttribute("href")}> found`).toHaveAttribute("data-next-link", "true");
    }
  });
});

describe("CRM Documents scan-gating copy (GAP-CRM-DOCUMENTS-05)", () => {
  it("states the accurate scan-gated behaviour, not an unverified 'quarantine' claim", () => {
    vi.mocked(rg.getSessionRoles).mockReturnValue(["crm_admin"]);
    render(<Page />);
    // Accurate copy (verified against crm-service download gating).
    expect(screen.getByText(/blocked from download automatically/i)).toBeInTheDocument();
    expect(screen.getByText(/expires within 30 days \(configurable\)/i)).toBeInTheDocument();
    // The old imprecise claim is gone.
    expect(screen.queryByText(/quarantined automatically and can never be downloaded/i)).not.toBeInTheDocument();
  });
});
