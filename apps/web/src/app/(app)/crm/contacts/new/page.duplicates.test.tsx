import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithIntl } from "@/lib/testUtils/intl";
import NewContactPage from "./page";
import {
  REAL_DUPLICATE_CHECK_RESPONSE,
  DUP_CONTACT_ASHA,
  DUP_CONTACT_MEERA,
} from "@/lib/crm/testFixtures/duplicateCheckResponse";

/**
 * The new-contact duplicate panel, fed the EXACT body crm-service answers POST /v1/crm/contacts/duplicate-check
 * with ({ data: [{ id, name, matchedFields, score 0-100 }] }) through the REAL parser (no mock of dataQuality).
 * Against that shape it used to show "Match 7000% on email, phone" and, without a name, the record's UUID.
 */
const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: vi.fn() }),
}));
vi.mock("@/app/_components/ds/Toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

const fetchMock = vi.fn();
let checkAnswer: unknown = REAL_DUPLICATE_CHECK_RESPONSE;

beforeEach(() => {
  pushMock.mockReset();
  fetchMock.mockReset();
  checkAnswer = REAL_DUPLICATE_CHECK_RESPONSE;
  fetchMock.mockImplementation((url: string) => {
    const body = url.endsWith("/v1/crm/contacts/duplicate-check") ? checkAnswer : url.endsWith("lead-field-rules") ? { data: [] } : {};
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

async function submitWithDuplicates() {
  renderWithIntl(<NewContactPage />);
  fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: "Asha Rao" } });
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "asha.rao@example.gov.in" } });
  fireEvent.click(screen.getByRole("button", { name: /create contact/i }));
  return screen.findByRole("region", { name: "Potential duplicates" });
}

describe("NewContactPage duplicate panel against the real server answer", () => {
  it("names each contact, links it, and shows a correctly scaled score", async () => {
    const panel = await submitWithDuplicates();
    expect(panel).toHaveTextContent("2 similar records already exist");
    expect(screen.getByRole("link", { name: "Asha Rao" })).toHaveAttribute("href", `/crm/contacts/${DUP_CONTACT_ASHA}`);
    expect(screen.getByRole("link", { name: "Meera Devi" })).toHaveAttribute("href", `/crm/contacts/${DUP_CONTACT_MEERA}`);
    expect(panel).toHaveTextContent("Match 70% on email, phone");
    expect(panel).toHaveTextContent("Match 30% on phone");
    expect(panel.textContent).not.toMatch(/\d{3,}%/);
  });

  it("never shows a record id: a match without a name reads 'Existing contact'", async () => {
    checkAnswer = { data: [{ id: DUP_CONTACT_MEERA, matchedFields: ["phone"], score: 30 }] };
    const panel = await submitWithDuplicates();
    expect(screen.getByRole("link", { name: "Existing contact" })).toHaveAttribute("href", `/crm/contacts/${DUP_CONTACT_MEERA}`);
    expect(panel.textContent).not.toContain(DUP_CONTACT_MEERA);
  });

  it("'Merge instead' goes to the named contact", async () => {
    await submitWithDuplicates();
    fireEvent.click(screen.getAllByRole("button", { name: /merge instead/i })[0]!);
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith(`/crm/contacts/${DUP_CONTACT_ASHA}`));
  });
});
