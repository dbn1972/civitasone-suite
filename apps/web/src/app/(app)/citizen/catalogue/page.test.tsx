import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const getCatalogueServicesMock = vi.fn();
vi.mock("../../../_data/citizenPartials", () => ({
  getCatalogueServices: (...args: unknown[]) => getCatalogueServicesMock(...args),
}));

vi.mock("next-intl/server", async () => {
  const messages = (await import("@/messages/en.json")).default as Record<string, unknown>;
  const { createTranslator } = await import("next-intl");
  function resolve(obj: unknown, dotted: string): unknown {
    return dotted.split(".").reduce<unknown>((acc, k) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[k] : undefined), obj);
  }
  return {
    getTranslations: async (namespace?: string) => {
      // Use a real ICU translator so plural keys (documentsCount/slaDays) render.
      const translator = createTranslator({ locale: "en", messages: messages as Record<string, never>, namespace: namespace as never });
      return (key: string, values?: Record<string, unknown>) => {
        try {
          return (translator as unknown as (k: string, v?: Record<string, unknown>) => string)(key, values);
        } catch {
          const found = resolve(namespace ? resolve(messages, namespace) : messages, key);
          return typeof found === "string" ? found : key;
        }
      };
    },
    getLocale: async () => "en",
    getMessages: async () => messages,
  };
});

import CataloguePage from "./page";

function renderPage(page: Promise<React.ReactElement>) {
  return page.then((ui) => render(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>));
}

const MOCK = [
  { id: "s1", serviceKey: "birth-cert", name: "Birth Certificate", ownerDepartment: "Health", version: 2, status: "published", channels: ["portal", "whatsapp"], requiredDocumentCount: 4, slaDays: 7 },
  { id: "s2", serviceKey: "trade-lic", name: "Trade Licence", ownerDepartment: "Revenue", version: 1, status: "published", channels: [], requiredDocumentCount: 1, slaDays: null },
];

describe("CataloguePage (GAP-CITIZEN-CATALOGUE-01/02/03/05)", () => {
  beforeEach(() => getCatalogueServicesMock.mockReset());

  it("CATALOGUE-01/03: headers == cells per row, including an SLA and an Apply column", async () => {
    getCatalogueServicesMock.mockResolvedValue({ data: MOCK, source: "api" });
    await renderPage(CataloguePage());
    const headers = document.querySelectorAll("thead th");
    const firstRowCells = document.querySelectorAll("tbody tr:first-child td");
    expect(headers.length).toBe(firstRowCells.length);
    expect(screen.getByText("SLA (days)")).toBeInTheDocument();
    // Apply column header present.
    expect(screen.getAllByText("Apply").length).toBeGreaterThanOrEqual(1);
  });

  it("CATALOGUE-02: the raw serviceKey slug is not shown and channels are humanized", async () => {
    getCatalogueServicesMock.mockResolvedValue({ data: MOCK, source: "api" });
    await renderPage(CataloguePage());
    expect(screen.queryByText("birth-cert")).not.toBeInTheDocument();
    // Channels render as a humanized, comma-joined label — never raw lowercase codes.
    expect(screen.getByText("Portal, WhatsApp")).toBeInTheDocument();
    expect(screen.queryByText("portal, whatsapp")).not.toBeInTheDocument();
  });

  it("CATALOGUE-03: an Apply link deep-links to the service's apply route", async () => {
    getCatalogueServicesMock.mockResolvedValue({ data: MOCK, source: "api" });
    await renderPage(CataloguePage());
    const applyLink = document.querySelector('a[href="/citizen/services/birth-cert/apply"]');
    expect(applyLink).not.toBeNull();
  });

  it("CATALOGUE-05: document count has a unit via ICU plural", async () => {
    getCatalogueServicesMock.mockResolvedValue({ data: MOCK, source: "api" });
    await renderPage(CataloguePage());
    expect(screen.getByText("4 documents")).toBeInTheDocument();
    expect(screen.getByText("1 document")).toBeInTheDocument();
    expect(screen.getByText("7 days")).toBeInTheDocument();
  });
});
