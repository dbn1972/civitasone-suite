import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const getSessionRolesMock = vi.fn((): string[] => ["payroll_admin"]);
vi.mock("@/lib/auth/roleGuard", () => ({
  getSessionRoles: () => getSessionRolesMock(),
  PAYROLL_ADMIN_ROLES: ["payroll_admin", "payroll_officer", "super_admin"],
}));
vi.mock("@/lib/entityAdapters/employee", () => ({
  searchEmployees: vi.fn(async () => []),
  resolveEmployees: vi.fn(async () => []),
}));

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import DisbursementPage from "./page";
import { eligibleBankFileRuns } from "./eligibility";
import type { IssuedFile, SigningSettings } from "./signingState";

const SIGNING_DEFAULT: SigningSettings = {
  config: { format: "pgp_detached", perBankOverrides: {}, encryptToBank: false, keyRef: "default" },
  isDefault: true,
  unsignedAllowed: true,
  key: { provider: "dev-file", present: true, fingerprint: "AB12CD34EF56AB12CD34EF56AB12CD34EF56AB12", detail: null },
};
const ISSUED: IssuedFile = {
  id: "f1", runNo: "RUN/2026/07", month: "2026-07", seq: 1, fileFormat: "csv", fileName: "bank_transfer_RUN-2026-07_2026-07.csv",
  lineCount: 12, createdAt: "2026-08-01T10:00:00Z", signatureFormat: "pgp_detached", signed: true, hasDetachedSignature: true,
  fileSha256: "ab".repeat(32), encryptedToBank: false,
};

// UX-017: DisbursementPage is a server component (translated via
// getTranslations(), which vitest.setup.ts mocks centrally -- no provider
// needed just for that call), but it also renders DisbursementTransferTable,
// a CLIENT component that now calls useTranslations(). Once rendered for
// real by testing-library, that child needs a genuine NextIntlClientProvider
// in the tree -- a module-level mock of next-intl/server cannot substitute
// for React context read by a hook. Discovered by this tranche: every prior
// server-page-with-a-translated-client-child test in this codebase either
// didn't exist yet or didn't render one; this is the first page.test.tsx
// hitting it directly.
async function renderPage() {
  const ui = await DisbursementPage();
  render(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);
}

describe("DisbursementPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    getSessionRolesMock.mockReset();
    getSessionRolesMock.mockReturnValue(["payroll_admin"]);
  });

  function mockResponses(
    overrides: {
      runs?: unknown;
      sponsor?: unknown;
      dsc?: unknown;
      transfers?: unknown;
      files?: IssuedFile[];
      signing?: SigningSettings | null;
      filesSource?: "api" | "error";
      signingSource?: "api" | "error";
      source?: "api" | "error";
      // UX-013: per-loader overrides, so a test can simulate ONE of the 4
      // independent loaders failing without the other 3 -- the shared
      // `source` above still applies to any loader that doesn't get its own.
      runsSource?: "api" | "error";
      sponsorSource?: "api" | "error";
      dscSource?: "api" | "error";
      transfersSource?: "api" | "error";
      dscStatus?: number;
      sponsorStatus?: number;
      transfersStatus?: number;
    } = {},
  ) {
    const source = overrides.source ?? "api";
    fetchJsonMock.mockImplementation((path: string) => {
      if (path.includes("/runs")) return Promise.resolve({ data: overrides.runs ?? [], source: overrides.runsSource ?? source });
      if (path.includes("sponsor-bank-config")) return Promise.resolve({ data: overrides.sponsor ?? null, source: overrides.sponsorSource ?? source, status: overrides.sponsorStatus });
      if (path.includes("dsc-config")) return Promise.resolve({ data: overrides.dsc ?? null, source: overrides.dscSource ?? source, status: overrides.dscStatus });
      if (path.includes("bank-file-signing")) return Promise.resolve({ data: overrides.signing === undefined ? SIGNING_DEFAULT : overrides.signing, source: overrides.signingSource ?? source });
      if (path.includes("disbursement/files")) return Promise.resolve({ data: overrides.files ?? [], source: overrides.filesSource ?? source });
      if (path.includes("disbursement/transfers")) return Promise.resolve({ data: overrides.transfers ?? [], source: overrides.transfersSource ?? source, status: overrides.transfersStatus });
      // Every real loader on this page declares its own empty default ([] or
      // null), and fetchJson() always resolves to that default on failure --
      // it never resolves to a bare null for an array-shaped loader. Match
      // that contract instead of returning null for any unrecognised path,
      // which previously crashed the whole page (transfers.filter on null)
      // before any assertion below ever ran.
      return Promise.resolve({ data: [], source });
    });
  }

  it("renders payroll runs eligible for disbursement", async () => {
    mockResponses({
      runs: [
        { id: "r1", payPeriod: "2026-07", employeeCount: 10, grossAmount: 100000, netAmount: 90000, status: "completed" },
      ],
    });

    await renderPage();

    // "2026-07" appears as run-selector option text, with the eligible run
    // auto-selected so the wizard's first-step CTA is immediately usable.
    // (There is no "Generate & Download" button in this component -- the
    // real 4-step wizard's step-0 action is "Next: Preview ->"; the previous
    // assertion here checked for text that has never existed.)
    expect(screen.getAllByText("2026-07").length).toBeGreaterThan(0);
    expect(screen.getByText("Next: Preview →")).toBeEnabled();
  });

  it("renders the run's net amount as rupees, not divided by 100 again", async () => {
    // Regression test: PayrollRunDetailSchema's netAmount is already RUPEES
    // (payroll-service divides totalNetMinor by 100 before returning it), so
    // this table must NOT run it through formatMoney()/cellType:"amount" --
    // that treats the value as minor units and would show ₹900.00 instead of
    // the correct ₹90,000.00 on the screen used to confirm a bank transfer.
    mockResponses({
      runs: [
        { id: "r1", payPeriod: "2026-07", employeeCount: 10, grossAmount: 100000, netAmount: 90000, status: "completed" },
      ],
    });

    await renderPage();

    // The amount only renders as its own exact text node on the Preview
    // step's "Net Amount" table row (the step-0 dropdown option concatenates
    // it with the pay period into one string) -- advance the wizard the way
    // an officer actually would before checking it.
    fireEvent.click(screen.getByText("Next: Preview →"));

    expect(screen.getByText("₹90,000.00")).toBeInTheDocument();
    expect(screen.queryByText("₹900.00")).not.toBeInTheDocument();
  });

  it("renders an empty state when there are no eligible runs", async () => {
    mockResponses({ runs: [] });

    await renderPage();

    expect(screen.getByText("No runs ready for a bank file")).toBeInTheDocument();
  });

  it("shows the error data-source badge when the API is unreachable", async () => {
    mockResponses({ source: "error" });

    await renderPage();

    expect(screen.getByText("Couldn't load — showing nothing")).toBeInTheDocument();
  });

  it("notes the mandate list endpoint is not available, without fabricating data", async () => {
    mockResponses({});

    await renderPage();

    expect(screen.getByText("Mandate list not yet available")).toBeInTheDocument();
  });

  // ───────────────────────────────────────────────────────────────────────
  // UX-013: the NACH Return File card used to check `eligibleRuns.length ===
  // 0` without looking at the runs loader's own source -- a real outage on
  // /api/v1/payroll/runs rendered pixel-identical to "no runs are currently
  // eligible," exactly the bug this gap targets. It's also the one section
  // on this page whose empty-check the ratchet guard actually flagged.
  // ───────────────────────────────────────────────────────────────────────
  it("[UX-013] shows the error state for the NACH Return File section — not 'no runs to reconcile' — when the RUNS loader specifically fails", async () => {
    mockResponses({ runsSource: "error" });

    await renderPage();

    // Both runs-dependent cards (bank-file wizard, NACH return) show it.
    expect(screen.getAllByText("We couldn't load payroll runs.").length).toBe(2);
    expect(screen.queryByText("No runs ready for a bank file")).not.toBeInTheDocument();
    expect(screen.queryByText("No runs to reconcile")).not.toBeInTheDocument();
    // The runs-derived stat shows "—", not a fabricated 0.
    expect(screen.getByText("Runs Ready for Disbursement").parentElement).toHaveTextContent("—");
  });

  it("[UX-013] still shows the honest 'no runs to reconcile' empty state when runs genuinely has zero completed/paid runs (source: api, [])", async () => {
    mockResponses({ runs: [] });

    await renderPage();

    expect(screen.getByText("No runs to reconcile")).toBeInTheDocument();
  });

  it("[UX-013 judgment call] a DIFFERENT loader (DSC config) failing does NOT show an error on the runs-dependent section — only the DSC stat goes to a dash", async () => {
    // This page combines 4 independent loaders. Gating the whole page (or
    // even just the runs section) on a single combined error flag would
    // conflate them -- a DSC-config outage has nothing to do with whether
    // the runs list loaded, and must not blank out data that loaded fine.
    mockResponses({
      runs: [{ id: "r1", payPeriod: "2026-07", employeeCount: 10, grossAmount: 100000, netAmount: 90000, status: "completed" }],
      dscSource: "error",
    });

    await renderPage();

    expect(screen.queryByText(/We couldn't load payroll runs\./)).not.toBeInTheDocument();
    expect(screen.getByText("Runs Ready for Disbursement").parentElement).toHaveTextContent("1");
    expect(screen.getByText("DSC Status").parentElement).toHaveTextContent("—");
  });

  it("[UX-013 judgment call] the TRANSFERS loader failing does NOT blank out the runs section — only the transfer stats go to a dash", async () => {
    mockResponses({
      runs: [{ id: "r1", payPeriod: "2026-07", employeeCount: 10, grossAmount: 100000, netAmount: 90000, status: "completed" }],
      transfersSource: "error",
    });

    await renderPage();

    expect(screen.getByText("Runs Ready for Disbursement").parentElement).toHaveTextContent("1");
    expect(screen.getByText("Transfers Credited").parentElement).toHaveTextContent("—");
    expect(screen.getByText("Transfers Failed").parentElement).toHaveTextContent("—");
  });

  // ───────────────────────────────────────────────────────────────────────
  // GAP-PAYROLL-DISBURSEMENT-01/04: role gating
  // ───────────────────────────────────────────────────────────────────────
  it.each([["employee"], ["manager"], ["hr_officer"]])(
    "[DISB-01/04] role '%s' gets a permission-denied view, not the transfers table or config forms",
    async (role) => {
      getSessionRolesMock.mockReturnValue([role]);
      mockResponses({ runs: [{ id: "r1", payPeriod: "2026-07", employeeCount: 10, grossAmount: 100000, netAmount: 90000, status: "completed" }] });
      await renderPage();
      expect(screen.getByText("Access restricted")).toBeInTheDocument();
      expect(screen.queryByText("Employee Bank Transfers")).not.toBeInTheDocument();
      expect(screen.queryByText("Sponsor Bank Configuration")).not.toBeInTheDocument();
      expect(screen.queryByLabelText(/P12 Keystore File/)).not.toBeInTheDocument();
      expect(fetchJsonMock).not.toHaveBeenCalled();
    },
  );

  it("[DISB-04] payroll_officer sees transfers + wizard but no Sponsor/DSC forms, and the admin-only config APIs are not called", async () => {
    getSessionRolesMock.mockReturnValue(["payroll_officer"]);
    mockResponses({ runs: [{ id: "r1", payPeriod: "2026-07", employeeCount: 10, grossAmount: 100000, netAmount: 90000, status: "completed" }] });
    await renderPage();
    expect(screen.getByText("Employee Bank Transfers")).toBeInTheDocument();
    expect(screen.getByText("Next: Preview →")).toBeEnabled();
    expect(screen.queryByText("Sponsor Bank Configuration")).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/P12 Keystore File/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Sponsor Code/)).not.toBeInTheDocument();
    expect(screen.getAllByText("Only a payroll administrator can view or change this.").length).toBeGreaterThan(0);
    const paths = fetchJsonMock.mock.calls.map((c) => String(c[0]));
    expect(paths.some((p) => p.includes("dsc-config"))).toBe(false);
    expect(paths.some((p) => p.includes("sponsor-bank-config"))).toBe(false);
    expect(screen.getByText("DSC Status").parentElement).toHaveTextContent("Admin only");
    // No error badge just because the officer can't read admin config.
    expect(screen.queryByText("Couldn't load — showing nothing")).not.toBeInTheDocument();
  });

  it("[DISB-04] payroll_admin sees the Sponsor and DSC configuration forms", async () => {
    mockResponses({});
    await renderPage();
    expect(screen.getByText("Sponsor Bank Configuration")).toBeInTheDocument();
    expect(screen.getByLabelText(/P12 Keystore File/)).toBeInTheDocument();
  });

  it("[DISB-04] a never-configured DSC (API 404) reads 'Not configured', not an outage", async () => {
    mockResponses({ dscSource: "error", dscStatus: 404, sponsorSource: "error", sponsorStatus: 404 });
    await renderPage();
    expect(screen.getByText("DSC Status").parentElement).toHaveTextContent("Not configured");
    expect(screen.queryByText("Couldn't load — showing nothing")).not.toBeInTheDocument();
  });

  // ───────────────────────────────────────────────────────────────────────
  // GAP-PAYROLL-DISBURSEMENT-03: bank-file signing
  // ───────────────────────────────────────────────────────────────────────
  it("[DISB-03] issued bank files list shows the server-stated signing badge and a signature download", async () => {
    mockResponses({
      files: [
        ISSUED,
        { ...ISSUED, id: "f2", fileName: "bank_transfer_dev.csv", signatureFormat: "none", signed: false, hasDetachedSignature: false },
      ],
    });
    await renderPage();
    expect(screen.getByText("Issued bank files")).toBeInTheDocument();
    expect(screen.getByText("bank_transfer_RUN-2026-07_2026-07.csv")).toBeInTheDocument();
    expect(screen.getByText("Signed (PGP)")).toBeInTheDocument();
    expect(screen.getByText("Unsigned (dev only)")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Download the signature of/ })).toHaveLength(1);
  });

  it("[DISB-03] no issued files yet reads as empty, and a files outage reads as an error -- never as empty", async () => {
    mockResponses({});
    await renderPage();
    expect(screen.getByText("No bank files issued yet")).toBeInTheDocument();
  });

  it("[DISB-03] a files fetch error renders the error state, not 'No bank files issued yet'", async () => {
    mockResponses({ filesSource: "error" });
    await renderPage();
    expect(screen.getByText("We couldn't load issued bank files.")).toBeInTheDocument();
    expect(screen.queryByText("No bank files issued yet")).not.toBeInTheDocument();
  });

  it("[DISB-03] payroll_admin sees the Bank file signing card with the key status", async () => {
    mockResponses({});
    await renderPage();
    expect(screen.getByText("Bank file signing")).toBeInTheDocument();
    expect(screen.getByText("Signing key present")).toBeInTheDocument();
    expect(screen.getByLabelText(/Signing format/)).toBeInTheDocument();
  });

  it("[DISB-03] payroll_officer sees the issued-files list but not the signing settings card, and the admin signing API is not called", async () => {
    getSessionRolesMock.mockReturnValue(["payroll_officer"]);
    mockResponses({ files: [ISSUED] });
    await renderPage();
    expect(screen.getByText("Signed (PGP)")).toBeInTheDocument();
    expect(screen.queryByLabelText(/Signing format/)).not.toBeInTheDocument();
    const paths = fetchJsonMock.mock.calls.map((c) => String(c[0]));
    expect(paths.some((p) => p.includes("bank-file-signing"))).toBe(false);
  });

  it("[DISB-03] a signing-settings outage shows an error, not an empty or default form", async () => {
    mockResponses({ signingSource: "error", signing: null });
    await renderPage();
    expect(screen.getByText("We couldn't load bank file signing settings.")).toBeInTheDocument();
    expect(screen.queryByLabelText(/Signing format/)).not.toBeInTheDocument();
  });

  // ───────────────────────────────────────────────────────────────────────
  // GAP-PAYROLL-DISBURSEMENT-07: no false empty on a transfers outage
  // ───────────────────────────────────────────────────────────────────────
  it("[DISB-07] a transfers fetch error renders the error state, not 'No transfers yet'", async () => {
    mockResponses({ transfersSource: "error" });
    await renderPage();
    expect(screen.getByText("We couldn't load bank transfers.")).toBeInTheDocument();
    expect(screen.queryByText("No transfers yet")).not.toBeInTheDocument();
  });

  // ───────────────────────────────────────────────────────────────────────
  // GAP-PAYROLL-DISBURSEMENT-01: masking happens before the client boundary
  // ───────────────────────────────────────────────────────────────────────
  it("[DISB-01] the full account number never reaches the rendered page", async () => {
    mockResponses({
      transfers: [{
        id: "tx-1", employeeId: "9b2f6c1e-0000-4000-8000-000000000001", employeeName: "Asha Rao",
        accountNumber: "123456789012", ifsc: "SBIN0001234", amountRupees: 1000, status: "success",
        nachBatchId: null, failureReason: null,
      }],
    });
    await renderPage();
    expect(screen.getByText("••••9012")).toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain("123456789012");
    expect(document.body.innerHTML).not.toContain("9b2f6c1e-0000-4000-8000-000000000001");
  });

  it("[TRANSFERS] page stats read the real ledger statuses: success = credited, failed + returned = failed", async () => {
    const row = {
      id: "t", employeeId: "e", employeeName: "A", accountNumberMasked: "XXXX1234", ifsc: "SBIN0001234",
      amountPaise: "100000", amountRupees: 1000, nachBatchId: null, failureReason: null,
    };
    mockResponses({
      transfers: [
        { ...row, id: "t1", status: "success" },
        { ...row, id: "t2", status: "returned", failureReason: "Account closed" },
        { ...row, id: "t3", status: "failed", failureReason: "Rejected" },
        { ...row, id: "t4", status: "sent" },
      ],
    });
    await renderPage();
    expect(screen.getByText("Transfers Credited").parentElement).toHaveTextContent("1");
    expect(screen.getByText("Transfers Failed").parentElement).toHaveTextContent("2");
  });

  // ───────────────────────────────────────────────────────────────────────
  // GAP-PAYROLL-DISBURSEMENT-09: section jump links
  // ───────────────────────────────────────────────────────────────────────
  it("[DISB-09] renders keyboard-reachable section links that target real section ids", async () => {
    mockResponses({});
    await renderPage();
    const nav = screen.getByRole("navigation", { name: "Page sections" });
    for (const id of ["transfers", "bank-file", "nach", "configuration"]) {
      const link = nav.querySelector(`a[href="#${id}"]`);
      expect(link).not.toBeNull();
      expect(document.getElementById(id)).not.toBeNull();
    }
  });
});

// GAP-PAYROLL-DISBURSEMENT-02: the eligibility rule, as a unit
describe("eligibleBankFileRuns", () => {
  const base = { runDate: "2026-07-31", payPeriod: "2026-07", employeeCount: 3, grossAmount: 1, netAmount: 1 };
  it("keeps approved ('completed') and paid runs, excludes draft/processing/failed", () => {
    const out = eligibleBankFileRuns([
      { ...base, id: "a", status: "draft" },
      { ...base, id: "b", status: "processing" },
      { ...base, id: "c", status: "failed" },
      { ...base, id: "d", status: "completed" },
      { ...base, id: "e", status: "paid" },
    ]);
    expect(out.map((r) => [r.id, r.status])).toEqual([["d", "completed"], ["e", "paid"]]);
    expect(out[0]).toMatchObject({ employeeCount: 3, netAmountRupees: 1 });
  });
});
