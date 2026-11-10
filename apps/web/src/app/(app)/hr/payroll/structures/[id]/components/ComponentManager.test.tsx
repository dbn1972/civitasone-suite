import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import axe from "axe-core";
import enMessages from "@/messages/en.json";
import hiMessages from "@/messages/hi.json";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }), usePathname: () => "/" }));
const browserJson = vi.fn();
vi.mock("@/lib/api/browserClient", () => ({ browserJson: (...a: unknown[]) => browserJson(...a) }));

import { ComponentManager, type StructureView } from "./ComponentManager";
import type { ComponentRow } from "@/lib/payComponents";

const row = (over: Partial<ComponentRow>): ComponentRow => ({
  id: "c1", code: "TA", name: "Transport Allowance", componentType: "earning", isTaxable: false, isActive: true, calc: "fixed",
  pctOfBasic: null, pctOfCtcBps: null, fixedMinor: "200000", employerCostClass: null, costPlacement: "inside_ctc",
  countsForPfWage: false, countsForEsiWage: false, countsForGratuity: false, lopApplicable: false, payslipOrder: 10, version: 3, ...over,
});
const RUN: StructureView = { id: "s1", name: "Project Staff Pay", kind: "run", isLocked: false, effectivelyLocked: false, templateVersion: 1, effectiveFrom: null };
const TPL: StructureView = { ...RUN, id: "t1", name: "Project Staff CTC - Delhi", kind: "ctc_template", effectiveFrom: "2026-12-01" };
const ROWS = [row({}), row({ id: "c2", code: "WASHING", name: "Washing Allowance", fixedMinor: "50000", payslipOrder: 20 })];

const ui = (p: Partial<React.ComponentProps<typeof ComponentManager>> = {}, locale: "en" | "hi" = "en") => render(
  <NextIntlClientProvider locale={locale} messages={locale === "en" ? enMessages : hiMessages}>
    <ComponentManager structure={RUN} components={ROWS} check={{ errors: [], warnings: [] }} canWrite canLock={false} {...p} />
  </NextIntlClientProvider>,
);

beforeEach(() => { browserJson.mockReset().mockResolvedValue({ id: "x", status: "accepted" }); refresh.mockReset(); });

describe("ComponentManager", () => {
  it("lists components with calculation text; a reader gets no write controls", () => {
    ui({ canWrite: false });
    expect(screen.getByText("Fixed ₹2,000")).toBeTruthy();
    expect(screen.getByText("Fixed ₹500")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /add component/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^edit$/i })).toBeNull();
  });

  it("validates, then POSTs a new fixed component in paise", async () => {
    ui();
    fireEvent.click(screen.getByRole("button", { name: /add component/i }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect((await screen.findAllByText(/capital letters, digits or underscores/i)).length).toBeGreaterThan(0);
    expect(browserJson).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(/^Code/), { target: { value: "conveyance" } });
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: "Conveyance Allowance" } });
    fireEvent.change(screen.getByLabelText(/Monthly amount/), { target: { value: "1600.50" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(browserJson).toHaveBeenCalledTimes(1));
    const [url, init] = browserJson.mock.calls[0]!;
    expect(url).toBe("v1/payroll/structures/s1/components");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toMatchObject({ code: "CONVEYANCE", name: "Conveyance Allowance", calc: "fixed", fixedMinor: "160050", employerCostClass: null });
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("edit sends PATCH with the optimistic version and no code", async () => {
    ui();
    fireEvent.click(screen.getByRole("button", { name: "Edit TA" }));
    expect((screen.getByLabelText(/^Code/) as HTMLInputElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/Monthly amount/), { target: { value: "2400" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(browserJson).toHaveBeenCalled());
    const [url, init] = browserJson.mock.calls[0]!;
    expect(url).toBe("v1/payroll/structures/s1/components/c1");
    expect(init.method).toBe("PATCH");
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ fixedMinor: "240000", version: 3 });
    expect("code" in body).toBe(false);
  });

  it("deactivate needs a reason of 10+ characters and POSTs it", async () => {
    ui();
    fireEvent.click(screen.getByRole("button", { name: "Deactivate TA" }));
    const dialog = await screen.findByRole("alertdialog");
    const confirm = within(dialog).getByRole("button", { name: "Deactivate" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "Withdrawn per office order 14/2026" } });
    fireEvent.click(confirm);
    await waitFor(() => expect(browserJson).toHaveBeenCalledWith("v1/payroll/structures/s1/components/c1/deactivate", {
      method: "POST", body: JSON.stringify({ reason: "Withdrawn per office order 14/2026" }),
    }));
  });

  it("reorder sends the full new order", async () => {
    ui();
    fireEvent.click(screen.getByRole("button", { name: "Move WASHING up" }));
    await waitFor(() => expect(browserJson).toHaveBeenCalledWith("v1/payroll/structures/s1/components/reorder", {
      method: "POST", body: JSON.stringify({ orderedIds: ["c2", "c1"] }),
    }));
    expect((screen.getByRole("button", { name: "Move TA up" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("a locked structure shows the notice and no edit controls", () => {
    ui({ structure: { ...RUN, effectivelyLocked: true } });
    expect(screen.getByText(/create a new version instead/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /add component/i })).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit TA" })).toBeNull();
  });

  it("template: balancing needs no amount, employer PF hides the calculation, flags are sent", async () => {
    ui({ structure: TPL, components: [], canLock: true });
    expect(screen.getByRole("button", { name: /lock \(approve\)/i })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /add component/i }));
    fireEvent.change(screen.getByLabelText(/^Code/), { target: { value: "SPECIAL" } });
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: "Special Allowance" } });
    fireEvent.change(screen.getByLabelText(/How the amount is calculated/), { target: { value: "balancing" } });
    fireEvent.click(screen.getByLabelText(/Reduced for loss of pay/));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(browserJson).toHaveBeenCalledTimes(1));
    expect(JSON.parse(browserJson.mock.calls[0]![1].body)).toMatchObject({ calc: "balancing", lopApplicable: true, pctOfCtcBps: null, fixedMinor: null });

    fireEvent.click(screen.getByRole("button", { name: /add component/i }));
    fireEvent.change(screen.getByLabelText(/^Type/), { target: { value: "employer_cost" } });
    fireEvent.change(screen.getByLabelText(/Employer cost class/), { target: { value: "employer_pf" } });
    expect(screen.queryByLabelText(/How the amount is calculated/)).toBeNull();
    expect(screen.getByText(/derived from the statutory configuration/i)).toBeTruthy();
  });

  it("shows template check errors and warnings", () => {
    ui({ structure: TPL, check: {
      errors: [{ code: "MULTIPLE_BALANCING", field: "calc", message: "x" }],
      warnings: [{ code: "BASIC_BELOW_50_PCT", field: "pctOfCtcBps", message: "y" }],
    } });
    expect(screen.getByText(/only one balancing component/i)).toBeTruthy();
    expect(screen.getByText(/Basic is under 50% of CTC/)).toBeTruthy();
  });

  it("is axe-clean (table, drawer form) and renders in Hindi", async () => {
    const { unmount } = ui();
    fireEvent.click(screen.getByRole("button", { name: /add component/i }));
    const results = await axe.run(document.body, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] }, rules: { "color-contrast": { enabled: false } } });
    expect(results.violations.map((v) => `${v.id}: ${v.nodes[0]?.html}`)).toEqual([]);
    unmount();
    ui({}, "hi");
    expect(screen.getAllByText("घटक जोड़ें").length).toBeGreaterThan(0);
  });
});
