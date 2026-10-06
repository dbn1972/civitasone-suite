import { describe, it, expect, vi } from "vitest";
import { render as rtlRender, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

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
  it("renders an in-app link for each of the 8 previously orphaned routes", async () => {
    await render(CitizenHome());
    const hrefs = Array.from(document.querySelectorAll("a")).map((a) => a.getAttribute("href"));
    for (const href of PREVIOUSLY_ORPHANED) {
      expect(hrefs).toContain(href);
    }
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
