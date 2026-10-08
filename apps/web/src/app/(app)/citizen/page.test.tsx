import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as rtlRender, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

// GAP2-CITIZEN-AUTHZ-ROLEGATE-01: the home page now hides officer-only tiles
// (discovery/intake/payments) for non-officer roles, so the session roles must
// be controllable in tests. CITIZEN_OFFICER_ROLES is re-exported unchanged.
const mockRoles = vi.fn<() => string[]>(() => []);
vi.mock("@/lib/auth/roleGuard", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth/roleGuard")>("@/lib/auth/roleGuard");
  return { ...actual, getSessionRoles: () => mockRoles() };
});

// next-intl/server resolves to a throwing guard under plain Vitest (no
// `react-server` condition) — a pre-existing, unrelated gap. Same minimal
// same-shape mock the sibling citizen page tests use.
vi.mock("next-intl/server", async () => {
  const messages = (await import("@/messages/en.json")).default as Record<string, unknown>;
  function resolve(obj: unknown, dotted: string): unknown {
    return dotted.split(".").reduce<unknown>((acc, k) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[k] : undefined), obj);
  }
  return {
    getTranslations: async (namespace?: string) => {
      const scope = namespace ? resolve(messages, namespace) : messages;
      return (key: string) => {
        const found = resolve(scope, key);
        return typeof found === "string" ? found : key;
      };
    },
    getLocale: async () => "en",
    getMessages: async () => messages,
  };
});

import CitizenHome from "./page";
import CitizenNotFound from "./not-found";

function render(page: Promise<React.ReactElement>) {
  return page.then((ui) => rtlRender(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>));
}

const PREVIOUSLY_ORPHANED = [
  "/citizen/catalogue",
  "/citizen/intake",
  "/citizen/documents",
  "/citizen/eligibility",
  "/citizen/payments",
  "/citizen/certificates",
  "/citizen/discovery",
  "/citizen/appeals",
];

describe("CitizenHome (GAP-CITIZEN-HOME-01/02/03)", () => {
  beforeEach(() => mockRoles.mockReturnValue(["citizen_officer"]));

  it("renders an in-app link for each of the 8 previously orphaned routes", async () => {
    await render(CitizenHome());
    const hrefs = Array.from(document.querySelectorAll("a")).map((a) => a.getAttribute("href"));
    for (const href of PREVIOUSLY_ORPHANED) {
      expect(hrefs).toContain(href);
    }
  });

  // GAP2-CITIZEN-AUTHZ-ROLEGATE-01: a citizen-role user must NOT see the
  // officer-only tiles (discovery/intake/payments); an officer still does.
  // Fails on the old code, which listed all tiles unconditionally.
  it("ROLEGATE-01: hides officer-only tiles (discovery/intake/payments) for a citizen-role user", async () => {
    mockRoles.mockReturnValue(["citizen"]);
    await render(CitizenHome());
    const hrefs = Array.from(document.querySelectorAll("a")).map((a) => a.getAttribute("href"));
    expect(hrefs).not.toContain("/citizen/discovery");
    expect(hrefs).not.toContain("/citizen/intake");
    expect(hrefs).not.toContain("/citizen/payments");
    // Genuine citizen self-service tiles are still shown.
    expect(hrefs).toContain("/citizen/grievances");
    expect(hrefs).toContain("/citizen/documents");
  });

  it("ROLEGATE-01: shows the officer-only tiles for an officer-role user", async () => {
    mockRoles.mockReturnValue(["citizen_officer"]);
    await render(CitizenHome());
    const hrefs = Array.from(document.querySelectorAll("a")).map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("/citizen/discovery");
    expect(hrefs).toContain("/citizen/intake");
    expect(hrefs).toContain("/citizen/payments");
  });

  it("HOME-02: subtitle mentions service delivery, not only grievances/RTI", async () => {
    await render(CitizenHome());
    expect(screen.getByText(/Service catalogue, applications, payments/i)).toBeInTheDocument();
  });

  it("HOME-03: uses the shared PageHeader (h1#page-heading), not legacy PageShell", async () => {
    await render(CitizenHome());
    const h1 = document.querySelector("h1#page-heading");
    expect(h1).not.toBeNull();
    expect(h1).toHaveTextContent("Citizen Services");
    // PageShell's hallmark slate background class must not be present.
    expect(document.querySelector(".page-shell")).toBeNull();
  });

  it("groups tiles under section headings", async () => {
    await render(CitizenHome());
    expect(screen.getByText("Service delivery")).toBeInTheDocument();
    expect(screen.getByText("Grievances, RTI & engagement")).toBeInTheDocument();
  });
});

describe("CitizenNotFound (GAP-CITIZEN-HOME-04)", () => {
  it("offers a 'Back to Citizen Services' link to /citizen", async () => {
    await render(CitizenNotFound());
    const back = screen.getByRole("link", { name: "Back to Citizen Services" });
    expect(back).toHaveAttribute("href", "/citizen");
  });
});
