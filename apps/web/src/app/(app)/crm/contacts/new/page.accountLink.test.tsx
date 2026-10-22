import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithIntl } from "@/lib/testUtils/intl";
import enMessages from "@/messages/en.json";
import NewContactPage from "./page";
import * as dq from "@/lib/crm/dataQuality";

vi.mock("@/lib/crm/dataQuality", async (orig) => {
  const actual = await orig<typeof import("@/lib/crm/dataQuality")>();
  return { ...actual, duplicateCheck: vi.fn() };
});
vi.mock("@/app/_components/ds/Toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.mocked(dq.duplicateCheck).mockReset();
  vi.mocked(dq.duplicateCheck).mockResolvedValue([]);
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

function answerPost(status: number, code: string) {
  fetchMock.mockImplementation(async (url: string) =>
    url.endsWith("lead-field-rules")
      ? { ok: true, status: 200, json: async () => ({ data: [] }) }
      : { ok: false, status, json: async () => ({ code, message: "server detail that must not be shown" }) },
  );
}

describe("NewContactPage: F5 account-link 422 (merged / inactive account)", () => {
  it("shows the clear inline error for ACCOUNT_INACTIVE, never the server text or the raw code", async () => {
    answerPost(422, "ACCOUNT_INACTIVE");
    renderWithIntl(<NewContactPage />);
    fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: "Asha" } });
    fireEvent.click(screen.getByRole("button", { name: /create contact/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(enMessages.crmAccountLinkError.inactive);
    expect(alert.textContent).not.toMatch(/server detail|ACCOUNT_INACTIVE/);
  });

  it("shows the not-found copy for ACCOUNT_NOT_FOUND", async () => {
    answerPost(422, "ACCOUNT_NOT_FOUND");
    renderWithIntl(<NewContactPage />);
    fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: "Asha" } });
    fireEvent.click(screen.getByRole("button", { name: /create contact/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(enMessages.crmAccountLinkError.notFound);
  });
});
