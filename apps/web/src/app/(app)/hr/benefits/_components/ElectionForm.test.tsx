import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import { ElectionForm, type BenefitPlan } from "./ElectionForm";

const PLAN: BenefitPlan = {
  id: "11111111-1111-4111-8111-111111111111",
  fy: "2026-27",
  name: "Flexi Benefit",
  // hra cap ₹50,000 = 5,000,000 paise
  components: [{ name: "hra", maxMinor: 5000000, taxExempt: true }],
};

function renderForm() {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <ElectionForm plans={[PLAN]} />
    </NextIntlClientProvider>,
  );
}

describe("ElectionForm — GAP2-HR-BENEFITS-07 inline cap check", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("an over-cap amount is blocked inline and never POSTed", async () => {
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: /make an election/i }));
    // ₹60,000 > ₹50,000 cap
    fireEvent.change(screen.getByLabelText(/hra/i), { target: { value: "60000" } });
    fireEvent.click(screen.getByRole("button", { name: /submit election/i }));

    await waitFor(() => {
      expect(screen.getByText(enMessages.benefits.amountOverCap)).toBeInTheDocument();
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a within-cap amount is accepted and POSTed", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: /make an election/i }));
    fireEvent.change(screen.getByLabelText(/hra/i), { target: { value: "40000" } });
    fireEvent.click(screen.getByRole("button", { name: /submit election/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [, opts] = fetchMock.mock.calls[0];
    const body = JSON.parse((opts as { body: string }).body);
    expect(body.elections).toEqual([{ component: "hra", electedMinor: 4000000 }]);
  });
});
