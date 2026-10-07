import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as rtlRender, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("./CertificateVerify", () => ({
  CertificateVerify: () => null,
}));

function render(ui: React.ReactElement) {
  return rtlRender(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);
}

// See citizen/grievances/page.test.tsx for the full explanation: next-intl/server
// resolves to a throwing guard under plain Vitest (no `react-server` condition),
// a pre-existing, unrelated gap. Minimal same-shape mock here too.
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

import CertificatesPage from "./page";

const MOCK_CERTS = [
  { id: "c1", certNo: "CERT-0001", certType: "birth", status: "active", validTo: "2030-01-01", verifyToken: "abcdef1234567890" },
];

function mockCertificates(result: { data: unknown; source: "api" | "error" }) {
  fetchJsonMock.mockImplementation((path: unknown) => {
    if (typeof path === "string" && path.includes("/citizen/certificates")) {
      return Promise.resolve(result);
    }
    return Promise.resolve({ data: [], source: "api" });
  });
}

describe("CertificatesPage", () => {
  beforeEach(() => fetchJsonMock.mockReset());

  it("renders issued certificates and the real active count on success", async () => {
    mockCertificates({ data: MOCK_CERTS, source: "api" });
    render(await CertificatesPage());
    expect(screen.getByText("CERT-0001")).toBeInTheDocument();
    expect(screen.getByText("1 active")).toBeInTheDocument();
  });

  it("GAP-CITIZEN-CERTIFICATES-02: the verify token is never printed; a 'Copy verify link' action is shown instead", async () => {
    mockCertificates({ data: MOCK_CERTS, source: "api" });
    render(await CertificatesPage());
    // The raw token (or its 12-char prefix) must not appear anywhere in the DOM text.
    expect(document.body.textContent).not.toContain("abcdef1234567890");
    expect(document.body.textContent).not.toContain("abcdef123456");
    expect(screen.getByRole("button", { name: "Copy verify link" })).toBeInTheDocument();
  });

  it("GAP-CITIZEN-CERTIFICATES-06: status is a human-readable pill, not a raw code", async () => {
    mockCertificates({ data: MOCK_CERTS, source: "api" });
    render(await CertificatesPage());
    // StatusPill humanizes "active" → "Active".
    expect(screen.getByText("Active")).toBeInTheDocument();
  });

  it("shows the honest empty state when a tenant genuinely has zero certificates (source: api, [])", async () => {
    mockCertificates({ data: [], source: "api" });
    render(await CertificatesPage());
    expect(screen.getByText("No certificates issued yet.")).toBeInTheDocument();
    expect(screen.getByText("0 active")).toBeInTheDocument();
  });

  it("shows the error state — not the empty-state prompt — on a real fetch failure (source: error)", async () => {
    mockCertificates({ data: [], source: "error" });
    render(await CertificatesPage());
    expect(screen.getByText("We couldn't load certificates.")).toBeInTheDocument();
    expect(screen.queryByText("No certificates issued yet.")).not.toBeInTheDocument();
    // The active-count badge in the header row shows "—", not a fabricated 0.
    expect(screen.getByText("— active")).toBeInTheDocument();
  });
});
