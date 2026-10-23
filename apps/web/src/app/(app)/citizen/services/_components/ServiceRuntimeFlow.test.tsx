import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import type { PublishedServiceRuntime } from "../_data/runtimeApi";

const saveDraftMock = vi.fn();
const updateDraftMock = vi.fn();
const listDraftsForServiceMock = vi.fn();
const submitDraftMock = vi.fn();
const createPaymentIntentMock = vi.fn();
const confirmPaymentMock = vi.fn();
const computeFeeBreakupMock = vi.fn();
const discardDraftMock = vi.fn();

vi.mock("../_data/runtimeApi", async () => {
  const actual = await vi.importActual<typeof import("../_data/runtimeApi")>("../_data/runtimeApi");
  return {
    ...actual,
    saveDraft: (...a: unknown[]) => saveDraftMock(...a),
    updateDraft: (...a: unknown[]) => updateDraftMock(...a),
    listDraftsForService: (...a: unknown[]) => listDraftsForServiceMock(...a),
    submitDraft: (...a: unknown[]) => submitDraftMock(...a),
    createPaymentIntent: (...a: unknown[]) => createPaymentIntentMock(...a),
    confirmPayment: (...a: unknown[]) => confirmPaymentMock(...a),
    computeFeeBreakup: (...a: unknown[]) => computeFeeBreakupMock(...a),
    discardDraft: (...a: unknown[]) => discardDraftMock(...a),
  };
});

// Minimal FormRenderer stub so the test drives field values deterministically.
vi.mock("@/app/_components/ds/designer/FormRenderer", () => ({
  FormRenderer: ({ onChange }: { onChange: (v: Record<string, string>) => void }) => (
    <button type="button" data-testid="type-name" onClick={() => onChange({ full_name: "Asha" })}>
      enter name
    </button>
  ),
}));

import { ServiceRuntimeFlow } from "./ServiceRuntimeFlow";

const DESIGN = {
  sections: [{ id: "s1", label: "Applicant", fieldIds: ["f1"] }],
  fields: { f1: { id: "f1", apiName: "full_name", type: "text", label: "Full name", required: false } },
} as unknown as PublishedServiceRuntime["formDesign"];

const SERVICE: PublishedServiceRuntime = {
  id: "svc-1",
  serviceKey: "trade-license",
  name: "Trade License",
  servicePattern: "certificate",
  description: "",
  slaDays: 7,
  channels: ["portal"],
  allowedApplicantTypes: ["citizen"],
  applicantTypeRejectMessage: null,
  requiredDocuments: [],
  feeFromMinor: 150000,
  feeCurrency: "INR",
  formDesign: DESIGN,
};

function renderFlow(props: Partial<React.ComponentProps<typeof ServiceRuntimeFlow>> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <ServiceRuntimeFlow service={SERVICE} {...props} />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  saveDraftMock.mockResolvedValue("draft-1");
  updateDraftMock.mockResolvedValue(undefined);
  listDraftsForServiceMock.mockResolvedValue([]); // no existing draft -> consent required
  submitDraftMock.mockResolvedValue({ applicationId: "app-1", trackingNo: "TRK-1" });
  createPaymentIntentMock.mockResolvedValue("pay-1");
  confirmPaymentMock.mockResolvedValue(undefined);
  computeFeeBreakupMock.mockResolvedValue(null);
  discardDraftMock.mockResolvedValue(undefined);
});
afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("ServiceRuntimeFlow consent gate (GAP-...-APPLY-05)", () => {
  it("does not autosave personal data until consent is ticked", async () => {
    renderFlow();
    // consent block shown
    expect(screen.getByText(enMessages.citizenServices.consentTitle)).toBeInTheDocument();

    // enter a value WITHOUT consent, advance the debounce timer
    fireEvent.click(screen.getByTestId("type-name"));
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(saveDraftMock).not.toHaveBeenCalled();

    // tick consent, enter again, advance timer -> now it saves
    fireEvent.click(screen.getByLabelText(enMessages.citizenServices.consentCheckbox));
    fireEvent.click(screen.getByTestId("type-name"));
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(saveDraftMock).toHaveBeenCalledTimes(1);
  });
});

// Sandbox payment is a fake-success path: it must be opt-in, never the default.
describe("ServiceRuntimeFlow payment mode (sandbox must be opt-in)", () => {
  const cs = enMessages.citizenServices;

  async function reachFeeStep() {
    fireEvent.click(screen.getByLabelText(cs.consentCheckbox));
    fireEvent.click(screen.getByTestId("type-name"));
    fireEvent.click(screen.getByRole("button", { name: cs.reviewAnswers }));
    fireEvent.click(screen.getByRole("button", { name: cs.continueToFee }));
  }

  it("defaults to gateway: no TEST MODE badge, honest unavailable note, no fake payment", async () => {
    renderFlow();
    await reachFeeStep();

    expect(screen.queryByText(cs.testModeBadge)).not.toBeInTheDocument();
    expect(screen.queryByText(cs.paySandboxAndSubmit)).not.toBeInTheDocument();
    expect(screen.getByText(cs.onlinePaymentUnavailable)).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: cs.submitPayAtCounter }));
    });

    expect(submitDraftMock).toHaveBeenCalledTimes(1);
    // never creates an intent or confirms a payment, and never reports success as paid
    expect(createPaymentIntentMock).not.toHaveBeenCalled();
    expect(confirmPaymentMock).not.toHaveBeenCalled();
    expect(screen.getByText(cs.submittedPaymentPendingTitle)).toBeInTheDocument();
    expect(screen.getByText(cs.paymentOnlineUnavailableSubmitted)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: cs.payNow })).not.toBeInTheDocument();
  });

  it("sandbox mode (explicit opt-in) shows the TEST MODE badge and confirms in sandbox", async () => {
    renderFlow({ paymentMode: "sandbox" });
    await reachFeeStep();

    expect(screen.getByText(cs.testModeBadge)).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: cs.paySandboxAndSubmit }));
    });

    expect(createPaymentIntentMock).toHaveBeenCalledTimes(1);
    expect(confirmPaymentMock).toHaveBeenCalledWith("pay-1", "sandbox");
  });
});

describe("ServiceRuntimeFlow fee breakup", () => {
  const cs = enMessages.citizenServices;
  async function reachFeeStep() {
    fireEvent.click(screen.getByLabelText(cs.consentCheckbox));
    fireEvent.click(screen.getByTestId("type-name"));
    fireEvent.click(screen.getByRole("button", { name: cs.reviewAnswers }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: cs.continueToFee }));
    });
  }

  it("shows the API fee breakup (base, exemption, payable) when the service returns one", async () => {
    computeFeeBreakupMock.mockResolvedValue({ baseMinor: 150000, payableMinor: 50000, exemptionLabel: "BPL family", currency: "INR" });
    renderFlow();
    await reachFeeStep();
    expect(computeFeeBreakupMock).toHaveBeenCalledWith("svc-1", expect.objectContaining({ full_name: "Asha" }));
    expect(screen.getByText(cs.feeBaseLine)).toBeInTheDocument();
    expect(screen.getByText("₹1,500")).toBeInTheDocument();
    expect(screen.getByText(cs.feeExemptionLine.replace("{label}", "BPL family"))).toBeInTheDocument();
    expect(screen.getByText("−₹1,000")).toBeInTheDocument();
    expect(screen.getByText(cs.feePayableLine)).toBeInTheDocument();
    expect(screen.getByText("₹500")).toBeInTheDocument();
  });

  it("falls back to the single published-fee line when there is no breakup", async () => {
    renderFlow();
    await reachFeeStep();
    expect(screen.getByText("Trade License — application fee")).toBeInTheDocument();
    expect(screen.queryByText(cs.feeBaseLine)).not.toBeInTheDocument();
  });
});

describe("ServiceRuntimeFlow discard draft", () => {
  const cs = enMessages.citizenServices;

  it("offers no discard when there is no saved draft", async () => {
    renderFlow();
    expect(screen.queryByRole("button", { name: cs.discardDraft })).not.toBeInTheDocument();
  });

  it("confirms, deletes the saved draft and returns to a clean, un-consented form", async () => {
    listDraftsForServiceMock.mockResolvedValue([{ id: "draft-9", formData: { full_name: "Asha" } }]);
    renderFlow();
    await act(async () => { await Promise.resolve(); });
    fireEvent.click(screen.getByRole("button", { name: cs.discardDraft }));
    expect(discardDraftMock).not.toHaveBeenCalled(); // needs an explicit second step
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: cs.discardDraftYes }));
    });
    expect(discardDraftMock).toHaveBeenCalledWith("draft-9");
    expect(screen.getByText(cs.consentTitle)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: cs.discardDraft })).not.toBeInTheDocument();
  });

  it("keep draft cancels the confirmation without deleting", async () => {
    listDraftsForServiceMock.mockResolvedValue([{ id: "draft-9", formData: {} }]);
    renderFlow();
    await act(async () => { await Promise.resolve(); });
    fireEvent.click(screen.getByRole("button", { name: cs.discardDraft }));
    fireEvent.click(screen.getByRole("button", { name: cs.discardDraftKeep }));
    expect(discardDraftMock).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: cs.discardDraft })).toBeInTheDocument();
  });

  it("a failed delete keeps the draft and shows an error", async () => {
    listDraftsForServiceMock.mockResolvedValue([{ id: "draft-9", formData: {} }]);
    discardDraftMock.mockRejectedValue(new Error("Could not delete."));
    renderFlow();
    await act(async () => { await Promise.resolve(); });
    fireEvent.click(screen.getByRole("button", { name: cs.discardDraft }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: cs.discardDraftYes }));
    });
    expect(screen.getByText("Could not delete.")).toBeInTheDocument();
  });
});
