import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithIntl } from "@/lib/testUtils/intl";
import enMessages from "@/messages/en.json";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: pushMock, refresh: vi.fn() }) }));

const browserFetchMock = vi.fn();
vi.mock("@/lib/api/browserClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/browserClient")>("@/lib/api/browserClient");
  return { ...actual, browserFetch: (...args: unknown[]) => browserFetchMock(...args) };
});

import EditContactForm from "./EditContactForm";

const initial = {
  name: "Asha Rao", email: "asha@example.com", phone: "9900000000", organization: "Acme",
  designation: "Director", city: "Bengaluru", leadStatus: "qualified", marketingConsent: true,
};

const reject = (code: string) =>
  new Response(JSON.stringify({ code, message: "server detail that must not be shown" }), { status: 422 });

describe("EditContactForm: F5 account-link 422 (merged / inactive account)", () => {
  beforeEach(() => {
    pushMock.mockReset();
    browserFetchMock.mockReset();
  });

  it("shows the clear inline error and does not redirect", async () => {
    browserFetchMock.mockResolvedValue(reject("ACCOUNT_INACTIVE"));
    renderWithIntl(<EditContactForm params={{ id: "c1" }} initial={initial} />);
    fireEvent.change(screen.getByLabelText("City"), { target: { value: "Pune" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(screen.getByText(enMessages.crmAccountLinkError.inactive)).toBeInTheDocument());
    expect(document.body.textContent).not.toMatch(/server detail|ACCOUNT_INACTIVE/);
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("shows the not-found copy for ACCOUNT_NOT_FOUND", async () => {
    browserFetchMock.mockResolvedValue(reject("ACCOUNT_NOT_FOUND"));
    renderWithIntl(<EditContactForm params={{ id: "c1" }} initial={initial} />);
    fireEvent.change(screen.getByLabelText("City"), { target: { value: "Pune" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(screen.getByText(enMessages.crmAccountLinkError.notFound)).toBeInTheDocument());
  });
});
