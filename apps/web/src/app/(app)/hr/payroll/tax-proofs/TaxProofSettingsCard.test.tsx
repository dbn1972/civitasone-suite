import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const browserFetch = vi.fn();
vi.mock("@/lib/api/browserClient", () => ({
  browserFetch: (...a: unknown[]) => browserFetch(...a),
  errorCodeFromResponse: async (res: Response) => {
    try { return ((await res.clone().json()) as { code?: string }).code ?? null; } catch { return null; }
  },
}));

import { TaxProofSettingsCard } from "./TaxProofSettingsCard";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const settings = (over: Record<string, unknown> = {}) => ({
  taxProofRetentionYears: 8, defaultYears: 8, minYears: 1, maxYears: 10, canEdit: true, canHold: false,
  taxProofCutoff: "01-31", defaultCutoff: "01-31", currentFyCutoffDate: "2026-01-31", canEditCutoff: true, taxProofVerifiedFromFy: null, canEditVerifiedFrom: true, ...over,
});

function ui() {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <TaxProofSettingsCard />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => browserFetch.mockReset());

describe("TaxProofSettingsCard (GAP-PAYROLL-TAX-DECLARATION-02)", () => {
  it("shows the current retention (default 8) and the statutory VERIFY note", async () => {
    browserFetch.mockResolvedValueOnce(json(settings()));
    ui();
    const years = await screen.findByLabelText("Retention (years)");
    expect(years).toHaveValue(8);
    expect(screen.getByText(/commonly read as 6 to 8 years/)).toBeInTheDocument();
  });

  it("rejects years outside 1-10 without calling the server", async () => {
    browserFetch.mockResolvedValueOnce(json(settings()));
    ui();
    const years = await screen.findByLabelText("Retention (years)");
    fireEvent.change(years, { target: { value: "11" } });
    fireEvent.click(screen.getByRole("button", { name: "Save retention" }));
    await screen.findByText("Enter a whole number of years from 1 to 10.");
    expect(browserFetch).toHaveBeenCalledTimes(1);
  });

  it("saves a valid period with an optional reason", async () => {
    browserFetch
      .mockResolvedValueOnce(json(settings()))
      .mockResolvedValueOnce(json({ id: "t", status: "accepted" }, 202))
      .mockResolvedValue(json(settings({ taxProofRetentionYears: 6 })));
    ui();
    fireEvent.change(await screen.findByLabelText("Retention (years)"), { target: { value: "6" } });
    fireEvent.change(screen.getByLabelText(/Reason for the change/), { target: { value: "Legal advised six years" } });
    fireEvent.click(screen.getByRole("button", { name: "Save retention" }));
    await waitFor(() => expect(browserFetch).toHaveBeenCalledWith("v1/payroll/tax-proofs/settings", {
      method: "PUT", body: JSON.stringify({ taxProofRetentionYears: 6, reason: "Legal advised six years" }),
    }));
    await screen.findByText("Retention period saved.");
  });

  it("is read-only for roles that cannot edit, and shows a retry on a load failure", async () => {
    browserFetch.mockResolvedValueOnce(json(settings({ canEdit: false })));
    const a = ui();
    expect(await screen.findByLabelText("Retention (years)")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Save retention" })).not.toBeInTheDocument();
    a.unmount();
    browserFetch.mockReset();
    browserFetch.mockResolvedValueOnce(new Response("", { status: 500 }));
    ui();
    await screen.findByText("Could not load the retention setting.");
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("shows the proof cutoff with its TDS consequence and sends a changed cutoff (payroll_admin)", async () => {
    browserFetch
      .mockResolvedValueOnce(json(settings()))
      .mockResolvedValueOnce(json({ id: "t", status: "accepted" }, 202))
      .mockImplementation(async () => json(settings({ taxProofCutoff: "02-28" })));
    ui();
    const cutoff = await screen.findByLabelText("Proof cutoff (month-day)");
    expect(cutoff).toHaveValue("01-31");
    expect(screen.getByText(/employees with unverified proofs will see higher TDS/)).toBeInTheDocument();
    fireEvent.change(cutoff, { target: { value: "13-45" } });
    fireEvent.click(screen.getByRole("button", { name: "Save retention" }));
    await screen.findByText("Enter the cutoff as month-day, for example 01-31.");
    expect(browserFetch).toHaveBeenCalledTimes(1);
    fireEvent.change(cutoff, { target: { value: "02-28" } });
    fireEvent.click(screen.getByRole("button", { name: "Save retention" }));
    await waitFor(() => expect(browserFetch).toHaveBeenCalledWith("v1/payroll/tax-proofs/settings", {
      method: "PUT", body: JSON.stringify({ taxProofRetentionYears: 8, taxProofCutoff: "02-28" }),
    }));
  });

  it("locks the cutoff for roles that may change retention but not the cutoff", async () => {
    browserFetch.mockResolvedValueOnce(json(settings({ canEditCutoff: false })));
    ui();
    expect(await screen.findByLabelText("Proof cutoff (month-day)")).toBeDisabled();
    expect(screen.getByLabelText("Retention (years)")).toBeEnabled();
  });

  it("the verified-TDS opt-in shows a warning, validates the FY, and sends the FY or null (payroll_admin)", async () => {
    browserFetch
      .mockResolvedValueOnce(json(settings()))
      .mockResolvedValueOnce(json({ id: "t", status: "accepted" }, 202))
      .mockImplementation(async () => json(settings({ taxProofVerifiedFromFy: "2026-27" })));
    ui();
    const from = await screen.findByLabelText(/Use verified proofs for TDS from financial year/);
    expect(from).toHaveValue("");
    expect(screen.getByRole("note")).toHaveTextContent(/Turning this on changes TDS/);
    fireEvent.change(from, { target: { value: "2026-28" } });
    fireEvent.click(screen.getByRole("button", { name: "Save retention" }));
    await screen.findByText("Enter a financial year such as 2026-27, or leave it blank to switch this off.");
    expect(browserFetch).toHaveBeenCalledTimes(1);
    fireEvent.change(from, { target: { value: "2026-27" } });
    fireEvent.click(screen.getByRole("button", { name: "Save retention" }));
    await waitFor(() => expect(browserFetch).toHaveBeenCalledWith("v1/payroll/tax-proofs/settings", {
      method: "PUT", body: JSON.stringify({ taxProofRetentionYears: 8, taxProofVerifiedFromFy: "2026-27" }),
    }));
  });

  it("locks the opt-in for roles other than payroll_admin", async () => {
    browserFetch.mockResolvedValueOnce(json(settings({ canEditVerifiedFrom: false, taxProofVerifiedFromFy: "2026-27" })));
    ui();
    const from = await screen.findByLabelText(/Use verified proofs for TDS from financial year/);
    expect(from).toBeDisabled();
    expect(from).toHaveValue("2026-27");
  });
});
