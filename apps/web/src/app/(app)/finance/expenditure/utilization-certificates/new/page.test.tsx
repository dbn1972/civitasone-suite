import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import NewUCPage from "./page";

// UX-017 (tranche 10): see AdvancesTable/NewAdvancePage's identical note --
// NewUCPage is a "use client" component calling useTranslations(), so it
// needs a real NextIntlClientProvider even though the page itself doesn't
// nest any other translated component.
function renderPage(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

function fillForm() {
  fireEvent.change(screen.getByLabelText("UC number"), { target: { value: "UC-001" } });
  fireEvent.change(screen.getByLabelText("Amount utilised (₹)"), { target: { value: "1000" } });
  fireEvent.change(screen.getByLabelText("Purpose"), { target: { value: "Scheme expenditure" } });
}

describe("NewUCPage", () => {
  beforeEach(() => {
    refreshMock.mockReset();
    vi.restoreAllMocks();
  });

  it("submits a utilization certificate (happy path, 202 accepted)", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 202 }));

    renderPage(<NewUCPage />);
    fillForm();
    fireEvent.click(screen.getByRole("button", { name: /submit uc/i }));

    await waitFor(() => expect(screen.getByText("Utilization certificate submitted.")).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/proxy/v1/finance/utilization-certificates",
      expect.objectContaining({ method: "POST" }),
    );
  });

  // UX-016: the shared `parseErrorMessage` helper used to build the message
  // from the backend's own `message`/`error` field, or (when the body
  // wasn't JSON) the RAW response text verbatim, falling back to a literal
  // `Request failed (${res.status})` -- the same class of leak
  // useFormError/toHumanError closes fleet-wide (UX-003).
  it("shows a clerk-safe message when submission fails, never the raw status or backend text", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ message: "scheme_closed: grant window has ended" }), { status: 422 }),
    );

    renderPage(<NewUCPage />);
    fillForm();
    fireEvent.click(screen.getByRole("button", { name: /submit uc/i }));

    const alert = await screen.findByRole("alert");
    await waitFor(() => expect(alert).toHaveTextContent(/couldn't save/i));
    expect(alert.textContent).not.toMatch(/scheme_closed/i);
    expect(alert.textContent).not.toMatch(/\b422\b/);
  });
});
