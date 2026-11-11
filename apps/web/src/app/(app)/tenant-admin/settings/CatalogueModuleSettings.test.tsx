import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, fireEvent, waitFor, within } from "@testing-library/react";
import { render } from "@/test-utils/intl-render";
import { render as rtlRender } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "@/messages/en.json";
import hi from "@/messages/hi.json";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { CatalogueModuleSettings, type CatalogueModule } from "./CatalogueModuleSettings";

const mod = (o: Partial<CatalogueModule> & { id: string; name: string }): CatalogueModule => ({
  cluster: "x", enabled: false, source: null, hardDeps: [], softDeps: [], requiredBy: [], ...o,
});
const MODULES: CatalogueModule[] = [
  mod({ id: "employee", name: "Employee Master (HRIS)", enabled: true, source: "user", requiredBy: ["payroll"] }),
  mod({ id: "finance", name: "Finance / General Ledger", enabled: false, hardDeps: [] }),
  mod({ id: "budget", name: "Budget & Appropriation", enabled: false, hardDeps: ["finance"] }),
  mod({ id: "procurement", name: "Procurement", enabled: false, hardDeps: ["finance", "budget"], softDeps: ["contract"] }),
  mod({ id: "payroll", name: "Payroll & Salary", enabled: true, source: "user", hardDeps: ["employee"], softDeps: ["finance"] }),
  mod({ id: "grant", name: "Grants & Schemes", enabled: true, source: "dep", hardDeps: [] }),
  mod({ id: "contract", name: "Contracts", enabled: false }),
];

describe("CatalogueModuleSettings (catalogue mode)", () => {
  beforeEach(() => { vi.restoreAllMocks(); refresh.mockReset(); });
  afterEach(() => vi.restoreAllMocks());

  it("shows what each module requires, uses when present, and who needs it", () => {
    render(<CatalogueModuleSettings modules={MODULES} />);
    const row = screen.getByTestId("catalogue-row-procurement");
    expect(within(row).getByText(/Requires: Finance \/ General Ledger, Budget & Appropriation/)).toBeInTheDocument();
    expect(within(row).getByText(/Uses when available: Contracts/)).toBeInTheDocument();
    expect(within(screen.getByTestId("catalogue-row-employee")).getByText(/Needed by: Payroll & Salary/)).toBeInTheDocument();
  });

  it("a module needed by another enabled module, and an auto-included one, cannot be switched off", () => {
    render(<CatalogueModuleSettings modules={MODULES} />);
    expect(screen.getByRole("switch", { name: /Employee Master \(HRIS\) module/ })).toBeDisabled();
    const grant = screen.getByRole("switch", { name: /Grants & Schemes module: Included automatically/ });
    expect(grant).toBeDisabled();
    expect(grant).toHaveAttribute("aria-checked", "true");
  });

  it("every switch has an accessible name and is described by its dependency hints", () => {
    render(<CatalogueModuleSettings modules={MODULES} />);
    for (const s of screen.getAllByRole("switch")) {
      expect(s).toHaveAccessibleName();
      expect(s.getAttribute("aria-describedby")).toBeTruthy();
    }
  });

  it("enabling lists the dependencies that will be auto-included (transitively), then posts to the catalogue endpoint", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    render(<CatalogueModuleSettings modules={MODULES} />);
    fireEvent.click(screen.getByRole("switch", { name: /Procurement module/ }));
    const dialog = await screen.findByRole("alertdialog");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(within(dialog).getByText(/will also enable the modules it requires: Budget & Appropriation, Finance \/ General Ledger/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    expect(fetchSpy.mock.calls[0]![0]).toBe("/api/proxy/v1/admin/composition/modules/procurement/enable");
    expect((fetchSpy.mock.calls[0]![1] as RequestInit).method).toBe("POST");
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Procurement enabled."));
    expect(refresh).toHaveBeenCalled();
  });

  it("never calls the retired older toggle endpoint", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    render(<CatalogueModuleSettings modules={MODULES} />);
    fireEvent.click(screen.getByRole("switch", { name: /Payroll & Salary module/ }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    for (const c of fetchSpy.mock.calls) expect(String(c[0])).not.toMatch(/\/tenant\/modules\/.*\/toggle/);
    expect(String(fetchSpy.mock.calls[0]![0])).toMatch(/modules\/payroll\/disable$/);
  });

  it("a 409 from the server is announced in the alert region with the module name", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 409 }));
    render(<CatalogueModuleSettings modules={MODULES} />);
    fireEvent.click(screen.getByRole("switch", { name: /Payroll & Salary module/ }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(screen.getAllByRole("alert").map((a) => a.textContent).join(" ")).toMatch(/Payroll & Salary cannot be disabled/));
  });

  it("renders the Hindi strings", () => {
    rtlRender(
      <NextIntlClientProvider locale="hi" messages={hi}>
        <CatalogueModuleSettings modules={MODULES} />
      </NextIntlClientProvider>,
    );
    expect(screen.getAllByText(/आवश्यक:/).length).toBeGreaterThan(0);
    expect(screen.getByRole("switch", { name: /Procurement module: बंद|Procurement मॉड्यूल: बंद/ })).toBeInTheDocument();
  });
});

describe("tenantModuleCatalogue messages", () => {
  it("English and Hindi carry exactly the same keys and the same ICU placeholders", () => {
    const e = (en as unknown as Record<string, Record<string, string>>).tenantModuleCatalogue!;
    const h = (hi as unknown as Record<string, Record<string, string>>).tenantModuleCatalogue!;
    expect(Object.keys(h).sort()).toEqual(Object.keys(e).sort());
    const ph = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const k of Object.keys(e)) {
      expect(h[k]!.length, k).toBeGreaterThan(0);
      expect(ph(h[k]!), k).toEqual(ph(e[k]!));
    }
  });
});
