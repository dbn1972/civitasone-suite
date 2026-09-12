import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("./CertificateVerify", () => ({
  CertificateVerify: () => null,
}));

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

  it("shows the honest empty state when a tenant genuinely has zero certificates (source: api, [])", async () => {
    mockCertificates({ data: [], source: "api" });
    render(await CertificatesPage());
    expect(screen.getByText("No certificates issued yet.")).toBeInTheDocument();
    expect(screen.getByText("0 active")).toBeInTheDocument();
  });

  it("shows the error state — not the empty-state prompt — on a real fetch failure (source: error)", async () => {
    mockCertificates({ data: [], source: "error" });
    render(await CertificatesPage());
    expect(screen.getByText("We couldn't load this certificates.")).toBeInTheDocument();
    expect(screen.queryByText("No certificates issued yet.")).not.toBeInTheDocument();
    // The active-count badge in the header row shows "—", not a fabricated 0.
    expect(screen.getByText("— active")).toBeInTheDocument();
  });
});
