import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { LwfConfigForm, type ExistingLwfConfig } from "./LwfConfigForm";

// UX-017: LwfConfigForm now reads its copy through next-intl
// (useTranslations("lwfConfigForm")), so every render needs a real provider
// in the tree -- same pattern as corrections/CreateCorrectionForm.test.tsx
// (tranche 11).
function renderForm(existingConfigs?: ExistingLwfConfig[]) {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <LwfConfigForm {...(existingConfigs ? { existingConfigs } : {})} />
    </NextIntlClientProvider>,
  );
}

const KA_STORED: ExistingLwfConfig = {
  state_code: "KA",
  employee_contrib_minor: "2500",
  employer_contrib_minor: 5000,
  frequency: "half_yearly",
};

const stateSelect = () => screen.getByLabelText(/State Code/) as HTMLSelectElement;
const empInput = () => screen.getByLabelText(/Employee Contribution/) as HTMLInputElement;
const erInput = () => screen.getByLabelText(/Employer Contribution/) as HTMLInputElement;
const submit = () => fireEvent.click(screen.getByRole("button", { name: "Save LWF Configuration" }));
const pickState = (code: string) => fireEvent.change(stateSelect(), { target: { value: code } });
const typeAmounts = (emp: string, er: string) => {
  fireEvent.change(empInput(), { target: { value: emp } });
  fireEvent.change(erInput(), { target: { value: er } });
};

describe("LwfConfigForm", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("requires a state code before opening the confirm dialog", () => {
    renderForm();
    submit();
    expect(screen.getByText("State code is required.")).toBeInTheDocument();
    expect(screen.queryByText("Save this LWF configuration?")).not.toBeInTheDocument();
  });

  it("saves an LWF configuration on confirm (happy path)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: { stateCode: "KA", saved: true } }), { status: 201 }),
    );

    renderForm();
    pickState("KA");
    typeAmounts("25", "50");
    submit();

    await waitFor(() => expect(screen.getByText("Save this LWF configuration?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Confirm & Save"));

    await waitFor(() => {
      expect(screen.getByText(/LWF configuration saved for KA\./)).toBeInTheDocument();
    });
    // Exact paise on the wire: 25.00 -> 2500, 50.00 -> 5000.
    const body = JSON.parse(String((fetchSpy.mock.calls[0]![1] as RequestInit).body));
    expect(body).toEqual({ stateCode: "KA", lwfEmployee: 2500, lwfEmployer: 5000 });
    expect(refreshMock).toHaveBeenCalled();
  });

  it("warns before overwriting an already-configured state (GAP-PAYROLL-STATUTORY-LWF-05)", async () => {
    renderForm([KA_STORED]);
    pickState("KA");
    fireEvent.change(empInput(), { target: { value: "30" } });
    submit();

    await waitFor(() => expect(screen.getByText("Save this LWF configuration?")).toBeInTheDocument());
    expect(screen.getByText(/KA already has an LWF configuration/)).toBeInTheDocument();
  });

  it("does not warn for a state that is not configured yet (GAP-PAYROLL-STATUTORY-LWF-05)", async () => {
    renderForm([KA_STORED]);
    pickState("MH");
    typeAmounts("25", "75");
    submit();

    await waitFor(() => expect(screen.getByText("Save this LWF configuration?")).toBeInTheDocument());
    expect(screen.queryByText(/already has an LWF configuration/)).not.toBeInTheDocument();
  });

  it("surfaces a clerk-safe error on the confirm dialog, never the server's raw code/status (error path) (UX-020)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 500 }));

    renderForm();
    pickState("KA");
    typeAmounts("25", "50");
    submit();

    await waitFor(() => expect(screen.getByText("Save this LWF configuration?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Confirm & Save"));

    await waitFor(() => {
      expect(screen.getByText(/couldn't save/i)).toBeInTheDocument();
    });
    expect(screen.queryByText(/API_ERROR: 500/)).not.toBeInTheDocument();
  });

  it("GAP-PAYROLL-STATUTORY-LWF-02/05: for a configured state sends only the changed values; unchanged ones are omitted (server keeps them)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "KA", status: "accepted", correlationId: "c" }), { status: 202 }),
    );

    renderForm([KA_STORED]);
    pickState("KA");
    fireEvent.change(empInput(), { target: { value: "30" } });
    fireEvent.change(screen.getByLabelText("Frequency"), { target: { value: "yearly" } });
    submit();

    await waitFor(() => expect(screen.getByText("Save this LWF configuration?")).toBeInTheDocument());
    expect(screen.getByText(/employer unchanged, frequency Yearly/)).toBeInTheDocument();
    fireEvent.click(screen.getByText("Confirm & Save"));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const body = JSON.parse(String((fetchSpy.mock.calls[0]![1] as RequestInit).body));
    expect(body).toEqual({ stateCode: "KA", lwfEmployee: 3000, lwfFrequency: "yearly" });
    expect("lwfEmployer" in body).toBe(false);
  });

  describe("GAP-PAYROLL-STATUTORY-LWF-05: amounts are required and exact", () => {
    it("a blank amount blocks submit with a field error and never reaches the server", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      renderForm();
      pickState("MH");
      fireEvent.change(empInput(), { target: { value: "25" } }); // employer left blank
      submit();

      expect(screen.queryByText("Save this LWF configuration?")).not.toBeInTheDocument();
      const alerts = screen.getAllByRole("alert");
      expect(alerts).toHaveLength(1);
      expect(alerts[0]).toHaveTextContent("Enter the amount in rupees. Type 0 if no contribution applies.");
      expect(erInput()).toHaveAttribute("aria-invalid", "true");
      expect(empInput()).not.toHaveAttribute("aria-invalid", "true");
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("both blank -> an error on each amount; a brand-new state with nothing filled in is never 'saved'", () => {
      renderForm();
      pickState("MH");
      submit();
      expect(screen.getAllByRole("alert")).toHaveLength(2);
      expect(screen.queryByText("Save this LWF configuration?")).not.toBeInTheDocument();
    });

    it("a sub-paise amount (1.005) is rejected, not silently turned into 0 paise", () => {
      renderForm();
      pickState("MH");
      typeAmounts("1.005", "50");
      submit();
      expect(screen.getByRole("alert")).toHaveTextContent("Enter a valid amount in rupees (at most 2 decimal places).");
      expect(screen.queryByText("Save this LWF configuration?")).not.toBeInTheDocument();
    });

    it("a malformed amount (1e3) is rejected", () => {
      renderForm();
      pickState("MH");
      typeAmounts("1e3", "50");
      submit();
      expect(screen.getByRole("alert")).toHaveTextContent(/valid amount in rupees/);
    });

    it("an explicitly typed 0 is accepted and sent as 0 paise", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ id: "MH", status: "accepted", correlationId: "c" }), { status: 202 }),
      );
      renderForm();
      pickState("MH");
      typeAmounts("0", "0");
      submit();
      await waitFor(() => expect(screen.getByText("Save this LWF configuration?")).toBeInTheDocument());
      fireEvent.click(screen.getByText("Confirm & Save"));
      await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
      const body = JSON.parse(String((fetchSpy.mock.calls[0]![1] as RequestInit).body));
      expect(body).toEqual({ stateCode: "MH", lwfEmployee: 0, lwfEmployer: 0 });
    });

    it("clearing a pre-filled amount of a configured state is an error, not 'keep current'", () => {
      renderForm([KA_STORED]);
      pickState("KA");
      fireEvent.change(erInput(), { target: { value: "" } });
      submit();
      expect(screen.getByRole("alert")).toHaveTextContent("Enter the amount in rupees.");
      expect(screen.queryByText("Save this LWF configuration?")).not.toBeInTheDocument();
    });

    it("re-submitting a configured state without changing anything says so instead of saving", () => {
      renderForm([KA_STORED]);
      pickState("KA");
      submit();
      expect(screen.getByRole("alert")).toHaveTextContent("Nothing has changed from the saved configuration.");
      expect(screen.queryByText("Save this LWF configuration?")).not.toBeInTheDocument();
    });
  });

  describe("GAP-PAYROLL-STATUTORY-LWF-05: state is picked from the list", () => {
    it("the state control is a select of states/UTs, not free text, and offers no unknown code", () => {
      renderForm();
      expect(stateSelect().tagName).toBe("SELECT");
      const options = within(stateSelect()).getAllByRole("option").map((o) => (o as HTMLOptionElement).value);
      expect(options).toContain("KA");
      expect(options).toContain("MH");
      expect(options).not.toContain("ZZ");
      // A typed/unknown value cannot be selected: the control falls back to "nothing selected".
      pickState("ZZ");
      expect(stateSelect().value).toBe("");
      submit();
      expect(screen.getByText("State code is required.")).toBeInTheDocument();
    });

    it("an already-configured legacy code that is not in the standard list stays selectable", () => {
      renderForm([{ state_code: "OR", employee_contrib_minor: 1000, employer_contrib_minor: 2000, frequency: "monthly" }]);
      const options = within(stateSelect()).getAllByRole("option").map((o) => (o as HTMLOptionElement).value);
      expect(options).toContain("OR");
    });

    it("choosing a configured state fills in its stored amounts and frequency", () => {
      renderForm([KA_STORED]);
      pickState("KA");
      expect(empInput().value).toBe("25.00");
      expect(erInput().value).toBe("50.00");
      expect((screen.getByLabelText("Frequency") as HTMLSelectElement).value).toBe("half_yearly");
      // switching to a state that is not configured clears them again
      pickState("MH");
      expect(empInput().value).toBe("");
      expect(erInput().value).toBe("");
    });
  });

  // Review (cluster 04): for a state with no row yet, a blank frequency is NOT "unchanged" --
  // payroll-service's stateRulesUpsert consumer stores the default (half_yearly) on first insert.
  describe("GAP-PAYROLL-STATUTORY-LWF-05: frequency wording for a first-time vs an existing state", () => {
    const freqSelect = () => screen.getByLabelText("Frequency") as HTMLSelectElement;
    const blankOption = () => within(freqSelect()).getByRole("option", { name: /^(Default|Keep current)/ });

    it("a state with no row yet and no frequency chosen: the dialog names the default frequency, not 'unchanged'; nothing extra is sent", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ id: "MH", status: "accepted", correlationId: "c" }), { status: 202 }),
      );
      renderForm([KA_STORED]);
      pickState("MH");
      expect(blankOption()).toHaveTextContent("Default (Half-yearly)");
      typeAmounts("25", "75");
      submit();

      await waitFor(() => expect(screen.getByText("Save this LWF configuration?")).toBeInTheDocument());
      expect(screen.getByText(/employee ₹25\.00, employer ₹75\.00, frequency Half-yearly\./)).toBeInTheDocument();
      expect(screen.queryByText(/frequency unchanged/)).not.toBeInTheDocument();
      fireEvent.click(screen.getByText("Confirm & Save"));

      await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
      // The default is the server's to apply -- the form does not invent a value on the wire.
      const body = JSON.parse(String((fetchSpy.mock.calls[0]![1] as RequestInit).body));
      expect(body).toEqual({ stateCode: "MH", lwfEmployee: 2500, lwfEmployer: 7500 });
    });

    it("with no configured states at all, the first state saved is described with the default frequency", async () => {
      renderForm();
      pickState("MH");
      typeAmounts("0", "0");
      submit();
      await waitFor(() => expect(screen.getByText("Save this LWF configuration?")).toBeInTheDocument());
      expect(screen.getByText(/frequency Half-yearly\./)).toBeInTheDocument();
    });

    it("a state with no row yet and a frequency chosen shows the chosen frequency", async () => {
      renderForm([KA_STORED]);
      pickState("MH");
      typeAmounts("25", "75");
      fireEvent.change(freqSelect(), { target: { value: "monthly" } });
      submit();
      await waitFor(() => expect(screen.getByText("Save this LWF configuration?")).toBeInTheDocument());
      expect(screen.getByText(/frequency Monthly\./)).toBeInTheDocument();
    });

    it("an already-configured state keeps saying 'unchanged' when the frequency is left alone (the stored one is kept)", async () => {
      renderForm([KA_STORED]);
      pickState("KA");
      expect(blankOption()).toHaveTextContent("Keep current frequency");
      fireEvent.change(empInput(), { target: { value: "30" } });
      // KA_STORED has half_yearly, which the form pre-selects; clearing it leaves the stored value alone.
      fireEvent.change(freqSelect(), { target: { value: "" } });
      submit();
      await waitFor(() => expect(screen.getByText("Save this LWF configuration?")).toBeInTheDocument());
      expect(screen.getByText(/employee ₹30\.00, employer unchanged, frequency unchanged\./)).toBeInTheDocument();
    });
  });
});
