import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import hiMessages from "@/messages/hi.json";
import { MedicalInsuranceCard } from "./MedicalInsuranceCard";
import { mapInsuranceResponse, type MedicalInsurance } from "./insuranceTypes";

const m = enMessages.medicalInsurance;
function withIntl(ui: React.ReactNode, locale: "en" | "hi" = "en") {
  return <NextIntlClientProvider locale={locale} messages={locale === "en" ? enMessages : hiMessages}>{ui}</NextIntlClientProvider>;
}

const FULL: MedicalInsurance = {
  employeeId: "e1", schemeType: "cghs", schemeId: "BEN-TEST-445566", cardNumber: "CGHS-TEST-77881234",
  cardNumberMasked: false, decryptFailed: false, validityFrom: "2026-04-01", validityTo: "2027-03-31",
  tier: "Semi-private ward", dependants: [{ name: "Test Spouse", relation: "spouse", dateOfBirth: "1990-05-01" }],
  dependantsCount: 1, annualLimitMinor: "50000000",
};

describe("MedicalInsuranceCard", () => {
  it("shows the record: translated scheme, card number, scheme id, validity, tier, limit and dependants", () => {
    render(withIntl(<MedicalInsuranceCard result={{ source: "api", data: FULL }} />));
    expect(screen.getByText(m.title)).toBeInTheDocument();
    expect(screen.getByText("CGHS")).toBeInTheDocument();
    expect(screen.getByTestId("insurance-card-number")).toHaveTextContent("CGHS-TEST-77881234");
    expect(screen.queryByText(m.maskedNote)).not.toBeInTheDocument();
    expect(screen.getByText("BEN-TEST-445566")).toBeInTheDocument();
    expect(screen.getByText("Semi-private ward")).toBeInTheDocument();
    expect(screen.getByText(/5,00,000/)).toBeInTheDocument();
    expect(screen.getByText(/Test Spouse \(Spouse\)/)).toBeInTheDocument();
  });

  it("an unreadable dependant is shown as unreadable, never as an empty name", () => {
    const data: MedicalInsurance = { ...FULL, decryptFailed: true, dependants: [{ relation: "spouse", name: null, dateOfBirth: null, decryptFailed: true }] };
    render(withIntl(<MedicalInsuranceCard result={{ source: "api", data }} />));
    expect(screen.getByText("Spouse (details unreadable)")).toBeInTheDocument();
  });

  it("a masked card number (manager view) is labelled as masked and dependants show relation only", () => {
    const masked: MedicalInsurance = {
      ...FULL, cardNumber: "**************1234", schemeId: "***********5566", cardNumberMasked: true,
      dependants: [{ relation: "spouse" }, { relation: "child" }], dependantsCount: 2,
    };
    render(withIntl(<MedicalInsuranceCard result={{ source: "api", data: masked }} />));
    expect(screen.getByTestId("insurance-card-number")).toHaveTextContent("**************1234");
    expect(screen.getByText(m.maskedNote)).toBeInTheDocument();
    expect(screen.getByText("Spouse")).toBeInTheDocument();
    expect(screen.getByText("Child")).toBeInTheDocument();
    expect(screen.queryByText(/Test Spouse/)).not.toBeInTheDocument();
  });

  it("a record that failed to decrypt shows an alert and no card number", () => {
    render(withIntl(<MedicalInsuranceCard result={{ source: "api", data: { ...FULL, cardNumber: null, schemeId: null, cardNumberMasked: true, decryptFailed: true } }} />));
    expect(screen.getByRole("alert")).toHaveTextContent(m.decryptFailed);
    expect(screen.getByTestId("insurance-card-number")).toHaveTextContent("—");
  });

  it("no record on file is said only when the read succeeded", () => {
    render(withIntl(<MedicalInsuranceCard result={{ source: "api", data: null, status: 404 }} />));
    expect(screen.getByText(m.noRecord)).toBeInTheDocument();
  });

  it("a failed read is 'unavailable' (or 'no access' on 403), never 'no record'", () => {
    const { unmount } = render(withIntl(<MedicalInsuranceCard result={{ source: "error", data: null, status: 500 }} />));
    expect(screen.getByText(m.unavailable)).toBeInTheDocument();
    expect(screen.queryByText(m.noRecord)).not.toBeInTheDocument();
    unmount();
    render(withIntl(<MedicalInsuranceCard result={{ source: "error", data: null, status: 403 }} />));
    expect(screen.getByText(m.forbidden)).toBeInTheDocument();
  });

  it("renders in Hindi", () => {
    render(withIntl(<MedicalInsuranceCard result={{ source: "api", data: FULL }} />, "hi"));
    expect(screen.getByText(hiMessages.medicalInsurance.title)).toBeInTheDocument();
    expect(screen.getByText(hiMessages.medicalInsurance.schemeType.cghs)).toBeInTheDocument();
  });
});

const MASKED: MedicalInsurance = {
  ...FULL, cardNumber: "**************1234", schemeId: "***********5566", cardNumberMasked: true,
};

describe("MedicalInsuranceCard — audited reveal (reveal tier)", () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it("without the reveal tier a masked value has no Reveal action", () => {
    render(withIntl(<MedicalInsuranceCard result={{ source: "api", data: MASKED }} />));
    expect(screen.queryByRole("button", { name: "Reveal" })).not.toBeInTheDocument();
    expect(screen.getByText(m.maskedNote)).toBeInTheDocument();
  });

  it("the reveal tier gets Reveal on card number and scheme id; it asks for a reason and POSTs to the insurance reveal endpoint", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ data: { value: "CGHS-TEST-77881234" } }), { status: 200 }));
    render(withIntl(<MedicalInsuranceCard result={{ source: "api", data: MASKED }} canReveal />));
    const buttons = screen.getAllByRole("button", { name: "Reveal" });
    expect(buttons).toHaveLength(2);
    expect(screen.getByText("**************1234")).toBeInTheDocument();
    fireEvent.click(buttons[0]!);
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.change(await screen.findByLabelText(/Reason for revealing/i), { target: { value: "hospital desk verification" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Reveal" }).pop()!);
    expect(await screen.findByText("CGHS-TEST-77881234")).toBeInTheDocument();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/proxy/v1/hrms/medical/insurance/e1/reveal");
    expect(JSON.parse(init.body as string)).toEqual({
      resourceType: "medical_insurance", resourceId: "e1", field: "cardNumber", reason: "hospital desk verification",
    });
  });

  it("a value the employee sees in full (not masked) or an unreadable one offers no Reveal", () => {
    const { unmount } = render(withIntl(<MedicalInsuranceCard result={{ source: "api", data: FULL }} canReveal />));
    expect(screen.queryByRole("button", { name: "Reveal" })).not.toBeInTheDocument();
    unmount();
    render(withIntl(<MedicalInsuranceCard result={{ source: "api", data: { ...MASKED, cardNumber: null, schemeId: null, decryptFailed: true } }} canReveal />));
    expect(screen.queryByRole("button", { name: "Reveal" })).not.toBeInTheDocument();
  });
});

describe("mapInsuranceResponse", () => {
  it("camelCases the API record and rejects anything else", () => {
    const mapped = mapInsuranceResponse({ data: {
      employee_id: "e1", scheme_type: "esic", scheme_id: null, card_number: "****5678", card_number_masked: true,
      decrypt_failed: false, validity_from: "2026-01-01", validity_to: null, tier: null, dependants: [],
      dependants_count: 0, annual_limit_minor: null,
    } });
    expect(mapped).toMatchObject({ employeeId: "e1", schemeType: "esic", cardNumber: "****5678", cardNumberMasked: true, validityTo: null, dependantsCount: 0 });
    const deps = mapInsuranceResponse({ data: {
      employee_id: "e1", scheme_type: "cghs", card_number: "****5678",
      dependants: [{ relation: "spouse" }, { relation: "child", name: null, dateOfBirth: null, decrypt_failed: true }],
    } })!.dependants;
    expect(deps).toEqual([{ relation: "spouse" }, { relation: "child", name: null, dateOfBirth: null, decryptFailed: true }]);
    expect(mapInsuranceResponse({ data: [] })).toBeNull();
    expect(mapInsuranceResponse(null)).toBeNull();
  });
});
