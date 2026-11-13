import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import hiMessages from "@/messages/hi.json";
import type { ReceiptPolicy } from "@civitasone/types";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
const EMP = { id: "bbbbbbbb-2222-4222-8222-222222222201", label: "Gita Menon (EMP-55)" };
vi.mock("@/lib/entityAdapters/employee", () => ({ searchEmployees: vi.fn(async () => []), resolveEmployees: vi.fn(async () => []) }));

import { CreateReimbursementForm, type ClaimSubject } from "./CreateReimbursementForm";

const SELF: ClaimSubject = { mode: "self", employeeId: EMP.id, label: EMP.label };
const POLICY: ReceiptPolicy = {
  categories: {
    food: { mode: "always", selfDeclarationUpToMinor: 100_000 },     // receipt always; self-declaration up to Rs 1,000
    fuel: { mode: "above_amount", thresholdMinor: 200_000 },         // receipt only above Rs 2,000
    medical: { mode: "never" },
  },
};

function renderForm(policy: ReceiptPolicy | null, locale: "en" | "hi" = "en") {
  render(
    <NextIntlClientProvider locale={locale} messages={locale === "en" ? enMessages : hiMessages}>
      <CreateReimbursementForm subject={SELF} policy={policy} />
    </NextIntlClientProvider>,
  );
}
function fill(category: string, amount: string) {
  fireEvent.change(screen.getByLabelText(/^Category/), { target: { value: category } });
  fireEvent.change(screen.getByLabelText(/^Amount/), { target: { value: amount } });
  fireEvent.change(screen.getByLabelText(/^Period/), { target: { value: "2026-08" } });
}
const submit = () => fireEvent.click(screen.getByRole("button", { name: "Submit Claim" }));
function accepted() {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ id: "r1", status: "accepted", correlationId: "c" }), { status: 202 }));
}
async function confirmSubmit() {
  const dialog = await screen.findByRole("alertdialog");
  fireEvent.click(within(dialog).getByRole("button", { name: "Submit claim" }));
}

describe("CreateReimbursementForm with a tenant receipt policy", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("never: a medical claim goes through without a receipt and shows no receipt hint", async () => {
    const f = accepted();
    renderForm(POLICY);
    fill("medical", "9000");
    expect(screen.queryByText(/need at least one receipt/)).not.toBeInTheDocument();
    submit();
    await confirmSubmit();
    await waitFor(() => expect(f).toHaveBeenCalled());
    expect(JSON.parse(String((f.mock.calls[0]![1] as RequestInit).body))).not.toHaveProperty("selfDeclaration");
  });

  it("above_amount: no receipt up to and including the threshold; blocked one paisa above, with the amount in the hint", async () => {
    const f = accepted();
    renderForm(POLICY);
    fill("fuel", "2000");
    expect(screen.getByText(/claims above ₹2,000\.00 need at least one receipt/)).toBeInTheDocument();
    submit();
    await confirmSubmit();
    await waitFor(() => expect(f).toHaveBeenCalledTimes(1));
    fill("fuel", "2000.01");
    submit();
    expect(document.querySelector(".pill.bad")).toHaveTextContent("Attach at least one receipt");
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("self-declaration: offered only when allowed for the amount; ticking it lets the claim through and is posted", async () => {
    const f = accepted();
    renderForm(POLICY);
    fill("food", "1500"); // above the self-declaration limit
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    submit();
    expect(document.querySelector(".pill.bad")).toHaveTextContent("Attach at least one receipt");

    fill("food", "1000"); // at the limit
    const box = screen.getByRole("checkbox", { name: /I declare that this expense was incurred/ });
    expect(box).not.toBeChecked();
    submit();
    expect(document.querySelector(".pill.bad")).toHaveTextContent("Attach at least one receipt"); // not signed yet
    fireEvent.click(box);
    submit();
    await confirmSubmit();
    await waitFor(() => expect(f).toHaveBeenCalled());
    const body = JSON.parse(String((f.mock.calls[0]![1] as RequestInit).body));
    expect(body).toMatchObject({ category: "food", amountMinor: 100_000, selfDeclaration: true });
    expect(body.attachmentKeys).toBeUndefined();
  });

  it("with no policy it behaves exactly as before (medical blocked, food free, no self-declaration box)", () => {
    const f = vi.spyOn(globalThis, "fetch");
    renderForm(null);
    fill("medical", "100");
    expect(screen.getByText("Medical claims need at least one receipt.")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    submit();
    expect(document.querySelector(".pill.bad")).toHaveTextContent("Attach at least one receipt");
    expect(f).not.toHaveBeenCalled();
  });

  it("renders the self-declaration copy in Hindi", () => {
    renderForm(POLICY, "hi");
    fireEvent.change(screen.getByLabelText(/^श्रेणी/), { target: { value: "food" } });
    fireEvent.change(screen.getByLabelText(/^राशि/), { target: { value: "500" } });
    expect(screen.getByRole("checkbox", { name: /मैं घोषणा करता/ })).toBeInTheDocument();
  });
});
