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
});

describe("CRM Documents client-side navigation (GAP-CRM-DOCUMENTS-03)", () => {
  it("links to Accounts/Contacts/Document Types via in-app links with correct hrefs", () => {
    vi.mocked(rg.getSessionRoles).mockReturnValue(["crm_admin"]);
    render(<Page />);
    expect(screen.getByRole("link", { name: /go to accounts/i })).toHaveAttribute("href", "/crm/accounts");
    expect(screen.getByRole("link", { name: /go to contacts/i })).toHaveAttribute("href", "/crm/contacts");
    expect(screen.getByRole("link", { name: /manage document types/i })).toHaveAttribute("href", "/crm/document-types");
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
