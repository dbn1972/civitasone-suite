import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as rtlRender, screen, fireEvent, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import hiMessages from "@/messages/hi.json";

const render = (ui: ReactElement, locale: "en" | "hi" = "en") =>
  rtlRender(
    <NextIntlClientProvider locale={locale} messages={locale === "en" ? enMessages : hiMessages}>
      {ui}
    </NextIntlClientProvider>,
  );

const createCaseMock = vi.fn();
const addPartyMock = vi.fn();
const updatePartyAdvocateMock = vi.fn();
const refreshMock = vi.fn();

vi.mock("../_data/client", () => ({
  createCase: (...a: unknown[]) => createCaseMock(...a),
  addParty: (...a: unknown[]) => addPartyMock(...a),
  updatePartyAdvocate: (...a: unknown[]) => updatePartyAdvocateMock(...a),
  fetchConfigNamespace: vi.fn().mockResolvedValue([]),
  fetchCourtBenches: vi.fn().mockResolvedValue([]),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock, push: vi.fn(), replace: vi.fn() }),
}));

import { RegisterCasePanel, AddPartyForm, EditAdvocateForm } from "./CaseIntake";

const COURT_ID = "11111111-1111-4111-8111-111111111111";
const courts = [{ id: COURT_ID, name: "District Court Pune", courtType: "district", establishmentCode: null }];

beforeEach(() => {
  vi.clearAllMocks();
});

describe("RegisterCasePanel", () => {
  it("POSTs the registerCaseBody shape (with a first party) via createCase", async () => {
    createCaseMock.mockResolvedValue({ caseId: "case-9" });
    render(<RegisterCasePanel courts={courts} />);
    fireEvent.click(screen.getByRole("button", { name: "Register case" }));

    fireEvent.change(screen.getByLabelText("CNR number (16 characters)"), { target: { value: "MHPU010012342026" } });
    fireEvent.change(screen.getByLabelText("Case type"), { target: { value: "civil" } });
    fireEvent.change(screen.getByLabelText("Case title"), { target: { value: "Sharma v. State" } });
    fireEvent.change(screen.getByLabelText("Filing date"), { target: { value: "2026-11-01" } });
    fireEvent.change(screen.getByLabelText("Court"), { target: { value: COURT_ID } });
    fireEvent.change(screen.getByLabelText("Party name"), { target: { value: "R. Sharma" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Register case" })[0]!);

    await waitFor(() => expect(createCaseMock).toHaveBeenCalledTimes(1));
    expect(createCaseMock).toHaveBeenCalledWith({
      cnrNumber: "MHPU010012342026",
      caseType: "civil",
      title: "Sharma v. State",
      filingDate: "2026-11-01",
      courtId: COURT_ID,
      parties: [{ partyRole: "petitioner", name: "R. Sharma" }],
    });
    expect(await screen.findByRole("link", { name: /Open case/ })).toHaveAttribute("href", "/court/cases/case-9");
    expect(refreshMock).toHaveBeenCalled();
  });

  it("blocks submit on a malformed CNR without calling the API", async () => {
    render(<RegisterCasePanel courts={courts} />);
    fireEvent.click(screen.getByRole("button", { name: "Register case" }));
    fireEvent.change(screen.getByLabelText("CNR number (16 characters)"), { target: { value: "short" } });
    fireEvent.change(screen.getByLabelText("Case type"), { target: { value: "civil" } });
    fireEvent.change(screen.getByLabelText("Case title"), { target: { value: "T" } });
    fireEvent.change(screen.getByLabelText("Court"), { target: { value: COURT_ID } });
    fireEvent.change(screen.getByLabelText("Party name"), { target: { value: "X" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Register case" })[0]!);
    expect(await screen.findByRole("alert")).toHaveTextContent("16 letters or digits");
    expect(createCaseMock).not.toHaveBeenCalled();
  });

  it("explains when no court exists, and renders in Hindi", () => {
    render(<RegisterCasePanel courts={[]} />, "hi");
    fireEvent.click(screen.getByRole("button", { name: "मामला दर्ज करें" }));
    expect(screen.getByRole("note")).toHaveTextContent("कोई न्यायालय पंजीकृत नहीं");
  });
});

describe("AddPartyForm", () => {
  it("calls addParty with role/name/advocate and a per-role partyIndex", async () => {
    addPartyMock.mockResolvedValue(undefined);
    const onDone = vi.fn();
    const existing = [
      { id: "p1", caseId: "case-1", partyRole: "respondent", name: "A", advocateName: null, advocateBarId: null, version: 1 },
    ];
    render(<AddPartyForm caseId="case-1" parties={existing} onDone={onDone} />);
    fireEvent.click(screen.getByRole("button", { name: "Add party" }));
    fireEvent.change(screen.getByLabelText("Party name"), { target: { value: "B Respondent" } });
    fireEvent.change(screen.getByLabelText("Advocate name (optional)"), { target: { value: "Adv. K" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Add party" })[0]!);
    await waitFor(() => expect(addPartyMock).toHaveBeenCalledTimes(1));
    expect(addPartyMock).toHaveBeenCalledWith("case-1", {
      partyRole: "respondent",
      name: "B Respondent",
      partyIndex: 1,
      advocateName: "Adv. K",
    });
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });
});

describe("EditAdvocateForm", () => {
  it("PATCHes the advocate with the party's expectedVersion", async () => {
    updatePartyAdvocateMock.mockResolvedValue(undefined);
    const party = { id: "p1", caseId: "c", partyRole: "petitioner", name: "A", advocateName: "Old", advocateBarId: "B/1", version: 3 };
    render(<EditAdvocateForm party={party} onDone={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit advocate" }));
    fireEvent.change(screen.getByLabelText("Advocate name (optional)"), { target: { value: "New Adv" } });
    fireEvent.click(screen.getByRole("button", { name: "Save advocate" }));
    await waitFor(() =>
      expect(updatePartyAdvocateMock).toHaveBeenCalledWith("p1", {
        advocateName: "New Adv",
        advocateBarId: "B/1",
        expectedVersion: 3,
      }),
    );
  });
});
