import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithIntl } from "@/lib/testUtils/intl";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

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

describe("EditContactForm: CLOS2-S1-07 account picker search failure", () => {
  beforeEach(() => browserFetchMock.mockReset());

  it("shows the search-error text, not 'No matches', when GET v1/crm/accounts fails", async () => {
    browserFetchMock.mockResolvedValue(new Response("{}", { status: 500 }));
    renderWithIntl(<EditContactForm params={{ id: "c1" }} initial={initial} />);
    const input = screen.getByPlaceholderText("Search accounts…");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "acme" } });
    await waitFor(() => expect(screen.getAllByText(/load results/i).length).toBeGreaterThan(0));
    expect(screen.queryByText("No matches")).not.toBeInTheDocument();
  });
});
