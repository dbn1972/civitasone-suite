import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { SponsorBankConfigForm } from "./SponsorBankConfigForm";

type Initial = Parameters<typeof SponsorBankConfigForm>[0]["initial"];

// UX-017: SponsorBankConfigForm now reads its copy through next-intl
// (useTranslations("sponsorBankConfigForm")), so every render needs a real
// provider in the tree.
function renderForm(initial: Initial) {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <SponsorBankConfigForm initial={initial} />
    </NextIntlClientProvider>,
  );
}

describe("SponsorBankConfigForm", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("requires sponsor code, IFSC and account before opening the confirm dialog (create mode)", () => {
    renderForm(null);
    fireEvent.click(screen.getByText("Save Configuration"));
    expect(screen.getByText("Sponsor code, IFSC and sponsor account are required.")).toBeInTheDocument();
  });

  it("saves the configuration on confirm (happy path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ status: "ok" }), { status: 200 }));

    renderForm(null);
    fireEvent.change(screen.getByLabelText(/Sponsor Code/), { target: { value: "SBIN" } });
    fireEvent.change(screen.getByLabelText(/Sponsor IFSC/), { target: { value: "SBIN0001234" } });
    fireEvent.change(screen.getByLabelText(/Sponsor Account/), { target: { value: "12345678901" } });
    fireEvent.click(screen.getByText("Save Configuration"));

    await waitFor(() => expect(screen.getByText("Save sponsor bank configuration?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Save configuration"));

    await waitFor(() => {
      expect(screen.getByText("Sponsor bank configuration saved.")).toBeInTheDocument();
    });
    expect(refreshMock).toHaveBeenCalled();
  });

  it("surfaces a server error on the confirm dialog (error path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 500 }));

    renderForm(null);
    fireEvent.change(screen.getByLabelText(/Sponsor Code/), { target: { value: "SBIN" } });
    fireEvent.change(screen.getByLabelText(/Sponsor IFSC/), { target: { value: "SBIN0001234" } });
    fireEvent.change(screen.getByLabelText(/Sponsor Account/), { target: { value: "12345678901" } });
    fireEvent.click(screen.getByText("Save Configuration"));

    await waitFor(() => expect(screen.getByText("Save sponsor bank configuration?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Save configuration"));

    await waitFor(() => {
      expect(screen.getByText(/couldn't save/i)).toBeInTheDocument();
    });
    expect(screen.queryByText(/API_ERROR/)).not.toBeInTheDocument();
  });

  it("does not require a sponsor account when one is already configured (update mode)", () => {
    renderForm({
      sponsorCode: "SBIN",
      sponsorIfsc: "SBIN0001234",
      sponsorAccount: "98765432109",
      settlementOffsetDays: 1,
      nachEnabled: true,
      apbsEnabled: false,
    });
    fireEvent.click(screen.getByText("Update Configuration"));
    expect(screen.queryByText("Sponsor code, IFSC and sponsor account are required.")).not.toBeInTheDocument();
  });
});
