import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

import { CertificateVerify } from "./CertificateVerify";

function wrap(ui: React.ReactElement) {
  return render(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);
}

async function submitToken(token: string) {
  fireEvent.change(screen.getByLabelText("Verification token (from QR code)"), { target: { value: token } });
  fireEvent.click(screen.getByRole("button", { name: "Verify" }));
}

describe("CertificateVerify (GAP-CITIZEN-CERTIFICATES-04/05)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("GAP-CITIZEN-CERTIFICATES-04: payloadHash is NOT shown by default and type/status are humanized", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({
        found: true, validity: "valid", certNo: "CERT-9", certType: "birth_certificate",
        status: "active", validTo: "2030-01-01", payloadHash: "deadbeefcafef00d",
      }), { status: 200 }),
    ) as unknown as typeof fetch);

    wrap(<CertificateVerify />);
    await submitToken("tok");

    await screen.findByText("CERT-9");
    // Humanized, not raw snake_case.
    expect(screen.getByText("Birth Certificate")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
    // The hash digest is behind a COLLAPSED <details> — not shown by default.
    const details = document.querySelector("details");
    expect(details).not.toBeNull();
    expect(details!.hasAttribute("open")).toBe(false);
    expect(details!.textContent).toContain("deadbeefcafef00d");
    // Opening the disclosure reveals it.
    fireEvent.click(screen.getByText("Technical details"));
    expect(screen.getByText("deadbeefcafef00d")).toBeInTheDocument();
  });

  it("GAP-CITIZEN-CERTIFICATES-05: a 500 with a raw body shows friendly copy, not the body", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("boom\n at internal", { status: 500 })) as unknown as typeof fetch);

    wrap(<CertificateVerify />);
    await submitToken("tok");

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).not.toContain("boom");
    expect(alert.textContent).not.toContain("internal");
    expect(alert.textContent).toMatch(/couldn't|could not/i);
  });

  it("a 404 renders the not-found state", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 404 })) as unknown as typeof fetch);
    wrap(<CertificateVerify />);
    await submitToken("tok");
    await waitFor(() => expect(screen.getByText("Certificate not found")).toBeInTheDocument());
  });
});
