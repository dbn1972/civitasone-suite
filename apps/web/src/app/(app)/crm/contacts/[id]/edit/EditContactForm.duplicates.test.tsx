import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithIntl } from "@/lib/testUtils/intl";
import {
  REAL_DUPLICATE_CHECK_RESPONSE,
  DUP_CONTACT_ASHA,
  DUP_CONTACT_MEERA,
} from "@/lib/crm/testFixtures/duplicateCheckResponse";

/**
 * The edit-contact duplicate panel, fed the EXACT body crm-service answers POST /v1/crm/contacts/duplicate-check
 * with ({ data: [{ id, name, matchedFields, score 0-100 }] }) through the REAL parser (dataQuality is not mocked).
 */
const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: vi.fn() }),
}));

const browserFetchMock = vi.fn();
vi.mock("@/lib/api/browserClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/browserClient")>("@/lib/api/browserClient");
  return { ...actual, browserFetch: (...args: unknown[]) => browserFetchMock(...args) };
});

import EditContactForm from "./EditContactForm";

function makeRes(ok: boolean, status: number, body: unknown): Response {
  const make = (): Response => ({ ok, status, headers: new Headers(), json: async () => body, clone: make }) as unknown as Response;
  return make();
}

const initial = {
  name: "Asha Rao",
  email: "asha.rao@example.gov.in",
  phone: "9900000000",
  organization: "Acme",
  designation: "Director",
  city: "Bhubaneswar",
  leadStatus: "qualified",
  marketingConsent: false,
};

let checkAnswer: unknown = REAL_DUPLICATE_CHECK_RESPONSE;
beforeEach(() => {
  pushMock.mockReset();
  browserFetchMock.mockReset();
  checkAnswer = REAL_DUPLICATE_CHECK_RESPONSE;
  browserFetchMock.mockImplementation((path: string) =>
    Promise.resolve(makeRes(true, 200, path === "v1/crm/contacts/duplicate-check" ? checkAnswer : {})),
  );
});

function changePhoneAndBlur() {
  const phone = screen.getByLabelText("Phone");
  fireEvent.change(phone, { target: { value: "9876543210" } });
  fireEvent.blur(phone);
}

describe("EditContactForm duplicate panel against the real server answer", () => {
  it("names the OTHER contact (never the one being edited), links it, and scales the score", async () => {
    // The contact being edited is the first match in the real answer; it must not be listed against itself.
    renderWithIntl(<EditContactForm params={{ id: DUP_CONTACT_ASHA }} initial={initial} />);
    changePhoneAndBlur();
    const panel = await screen.findByRole("region", { name: "Potential duplicates" });
    expect(screen.getByRole("link", { name: "Meera Devi" })).toHaveAttribute("href", `/crm/contacts/${DUP_CONTACT_MEERA}`);
    expect(screen.queryByRole("link", { name: "Asha Rao" })).not.toBeInTheDocument();
    expect(panel).toHaveTextContent("Match 30% on phone");
    expect(panel.textContent).not.toMatch(/\d{3,}%/);
    expect(panel.textContent).not.toContain(DUP_CONTACT_ASHA);
  });

  it("never shows a record id: a match without a name reads 'Existing contact'", async () => {
    checkAnswer = { data: [{ id: DUP_CONTACT_MEERA, matchedFields: ["phone"], score: 30 }] };
    renderWithIntl(<EditContactForm params={{ id: "c1" }} initial={initial} />);
    changePhoneAndBlur();
    const panel = await screen.findByRole("region", { name: "Potential duplicates" });
    expect(screen.getByRole("link", { name: "Existing contact" })).toHaveAttribute("href", `/crm/contacts/${DUP_CONTACT_MEERA}`);
    expect(panel.textContent).not.toContain(DUP_CONTACT_MEERA);
  });
});
