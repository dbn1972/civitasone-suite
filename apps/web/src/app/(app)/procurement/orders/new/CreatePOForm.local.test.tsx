/**
 * M10: the PO form for a tenant without the Finance module asks for no budget
 * sanction and never calls finance. Without the prop the form is the one the
 * existing CreatePOForm tests pin.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import { CreatePOForm } from "./CreatePOForm";

function renderForm(localApproval?: boolean) {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages as never}>
      {localApproval === undefined ? <CreatePOForm /> : <CreatePOForm localApproval={localApproval} />}
    </NextIntlClientProvider>,
  );
}
const urls = (spy: { mock: { calls: unknown[][] } }) => spy.mock.calls.map((c) => String(c[0]));

describe("CreatePOForm: local approval mode", () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it("shows a note instead of the sanction picker, links to the approval limits, and never asks finance for sanctions", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify({ data: [] }), { status: 200 }));
    renderForm(true);
    expect(screen.getByText(/does not use the Finance module/)).toBeInTheDocument();
    expect(screen.getByText("View approval limits")).toHaveAttribute("href", "/procurement/approval-settings");
    expect(screen.queryByText(enMessages.procurement.poForm.sanctionLabel)).toBeNull();
    await new Promise((r) => setTimeout(r, 50));
    expect(urls(spy).filter((u) => u.includes("finance/sanctions"))).toEqual([]);
  });

  it("without the prop, or with it false, the sanction picker and the sanctions lookup are unchanged", async () => {
    for (const flag of [undefined, false]) {
      const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify({ data: [] }), { status: 200 }));
      renderForm(flag);
      expect(screen.getAllByText(enMessages.procurement.poForm.sanctionLabel).length).toBeGreaterThan(0);
      await waitFor(() => expect(urls(spy).some((u) => u.includes("finance/sanctions"))).toBe(true));
      expect(screen.queryByText(/does not use the Finance module/)).toBeNull();
      cleanup();
      spy.mockRestore();
    }
  });
});
