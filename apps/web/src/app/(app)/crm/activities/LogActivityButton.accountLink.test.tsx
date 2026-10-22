import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithIntl } from "@/lib/testUtils/intl";
import enMessages from "@/messages/en.json";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const browserFetch = vi.fn();
vi.mock("@/lib/api/browserClient", () => ({
  browserFetch: (...args: unknown[]) => browserFetch(...args),
  errorMessageFromResponse: async () => "err",
}));

import { LogActivityButton } from "./LogActivityButton";

beforeEach(() => browserFetch.mockReset());

describe("LogActivityButton: F5 account-link 422 (merged / inactive account)", () => {
  it("shows the clear inline error instead of the generic save failure", async () => {
    browserFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ data: [] }) }); // contacts
    browserFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ code: "ACCOUNT_INACTIVE", message: "server detail" }), { status: 422 }),
    );
    renderWithIntl(<LogActivityButton />);
    fireEvent.click(screen.getByRole("button", { name: "+ Log Activity" }));
    await waitFor(() => expect(screen.getByLabelText(/^Notes/)).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/^Notes/), { target: { value: "Called the ward office" } });
    fireEvent.click(screen.getByRole("button", { name: "Save activity" }));

    await waitFor(() => expect(screen.getByText(enMessages.crmAccountLinkError.inactive)).toBeInTheDocument());
    expect(document.body.textContent).not.toMatch(/server detail|ACCOUNT_INACTIVE/);
  });
});
