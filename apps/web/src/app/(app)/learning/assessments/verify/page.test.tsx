import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const verifyCertificateMock = vi.fn();
vi.mock("../../_data", () => ({
  verifyCertificate: (...a: unknown[]) => verifyCertificateMock(...a),
}));

import VerifyPage from "./page";

beforeEach(() => {
  verifyCertificateMock.mockReset();
});

async function renderPage(search: Record<string, string> = {}) {
  render(await VerifyPage({ searchParams: search }));
}

describe("VerifyPage — GAP-LEARNING-ASSESSMENTS-VERIFY-01/02/04", () => {
  it("VERIFY-02: a too-short token shows a format error without calling the API", async () => {
    await renderPage({ token: "abc" });
    expect(screen.getByText("Invalid token format")).toBeInTheDocument();
    expect(verifyCertificateMock).not.toHaveBeenCalled();
  });

  it("VERIFY-02: a 404 shows 'Certificate not found'", async () => {
    verifyCertificateMock.mockResolvedValue({ data: null, source: "error", status: 404 });
    await renderPage({ token: "valid-token-123" });
    expect(screen.getByText("Certificate not found")).toBeInTheDocument();
  });

  it("VERIFY-02: a 500 shows a retry error state, not 'not found'", async () => {
    verifyCertificateMock.mockResolvedValue({ data: null, source: "error", status: 500 });
    await renderPage({ token: "valid-token-123" });
    expect(screen.queryByText("Certificate not found")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
  });

  it("VERIFY-04: dates use formatIndianDate (dd Mon yyyy), not toLocaleDateString", async () => {
    verifyCertificateMock.mockResolvedValue({
      data: { certificateNo: "CERT-9", assessmentId: "asmt-1", issuedAt: "2026-09-14", validUntil: null, status: "active" },
      source: "api",
    });
    await renderPage({ token: "valid-token-123" });
    expect(screen.getByText("14 Sep 2026")).toBeInTheDocument();
  });

  it("VERIFY-01: when the backend omits employeeId, no raw employee UUID is rendered", async () => {
    verifyCertificateMock.mockResolvedValue({
      data: { certificateNo: "CERT-9", assessmentId: "asmt-1", issuedAt: "2026-09-14", validUntil: null, status: "active" },
      source: "api",
    });
    await renderPage({ token: "valid-token-123" });
    // the Details card (which prints employee ref) is not rendered at all
    expect(screen.queryByText(/Employee ref/)).not.toBeInTheDocument();
  });
});
