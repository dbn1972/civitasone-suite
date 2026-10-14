import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

const browserFetch = vi.fn();
vi.mock("@/lib/api/browserClient", () => ({
  browserFetch: (...args: unknown[]) => browserFetch(...args),
  errorMessageFromResponse: async () => "err",
}));

import { ContactDetailActions } from "./ContactDetailActions";

describe("ContactDetailActions inline client validation (SF-14a)", () => {
  beforeEach(() => {
    browserFetch.mockReset();
    refreshMock.mockReset();
  });

  it("blocks an empty save with an inline aria-invalid error and no request, then fixes and resubmits", async () => {
    render(<ContactDetailActions contactId="c-1" name="Asha Rao" />);
    fireEvent.click(screen.getByRole("button", { name: "Log Activity" }));
    fireEvent.click(await screen.findByRole("button", { name: "Save activity" }));

    expect(await screen.findByText("Enter the notes for this activity.")).toBeInTheDocument();
    expect(screen.getByLabelText(/^Notes/)).toHaveAttribute("aria-invalid", "true");
    expect(browserFetch).not.toHaveBeenCalled();

    browserFetch.mockResolvedValueOnce({ ok: true });
    fireEvent.change(screen.getByLabelText(/^Notes/), { target: { value: "Met at the ward office" } });
    fireEvent.click(screen.getByRole("button", { name: "Save activity" }));

    await waitFor(() => expect(browserFetch).toHaveBeenCalledTimes(1));
    const [url, init] = browserFetch.mock.calls[0]!;
    expect(url).toBe("v1/crm/activities");
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({ contactId: "c-1", text: "Met at the ward office" });
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    expect(screen.queryByText("Enter the notes for this activity.")).not.toBeInTheDocument();
  });
});
