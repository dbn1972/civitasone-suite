import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import { CertificateVerify } from "./CertificateVerify";

function wrap(ui: React.ReactElement) {
  return render(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);
}

describe("CertificateVerify error rendering (CLOS-S1-09)", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("offline verify shows verifyFailed, not raw 'Failed to fetch'", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))) as unknown as typeof fetch);
    wrap(<CertificateVerify />);
    fireEvent.change(screen.getByLabelText("Verification token (from QR code)"), { target: { value: "tok" } });
    fireEvent.click(screen.getByRole("button", { name: "Verify" }));
    expect(await screen.findByText(enMessages.citizenCertificates.verifyFailed)).toBeInTheDocument();
    expect(screen.queryByText("Failed to fetch")).toBeNull();
  });
});
