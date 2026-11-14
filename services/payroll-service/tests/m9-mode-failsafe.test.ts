/**
 * M9: a settings-read error stays on the finance path. An explicit 'finance' override that cannot be read must never
 * become export because the tenant has no Finance module.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const scopedRead = vi.fn();
vi.mock("../src/shared/db.js", () => ({ scopedRead: (...a: unknown[]) => scopedRead(...a), db: {} }));

import { resolveLedgerModeDetail, runLedgerModeTx } from "../src/modules/ledger-export/mode.js";
import { setModuleKeyFetcher } from "../src/shared/tenant-modules.js";

const T = "11111111-2222-4333-8444-555555555555";

describe("resolveLedgerModeDetail fails towards finance", () => {
  beforeEach(() => { scopedRead.mockReset(); setModuleKeyFetcher(async () => ["payroll"]); /* no Finance */ });
  afterEach(() => setModuleKeyFetcher());

  it("a failing settings read answers finance even though the tenant has no Finance module", async () => {
    scopedRead.mockRejectedValue(new Error("connection reset"));
    expect(await resolveLedgerModeDetail(T)).toMatchObject({ mode: "finance", override: null });
  });
  it("a readable settings row still works: no override and no Finance is export; an explicit finance override is finance", async () => {
    scopedRead.mockResolvedValue([]);
    expect((await resolveLedgerModeDetail(T)).mode).toBe("export");
    scopedRead.mockResolvedValue([{ ledger_mode_override: "finance" }]);
    expect(await resolveLedgerModeDetail(T)).toMatchObject({ mode: "finance", source: "override" });
  });
});

describe("runLedgerModeTx", () => {
  const tx = (rows: unknown) => ({ execute: vi.fn().mockResolvedValue(rows) }) as never;
  it("reads the run's pinned mode; NULL, a missing run and an empty answer mean finance", async () => {
    expect(await runLedgerModeTx(tx([{ ledger_mode: "export" }]), "r")).toBe("export");
    expect(await runLedgerModeTx(tx([{ ledger_mode: "finance" }]), "r")).toBe("finance");
    expect(await runLedgerModeTx(tx([{ ledger_mode: null }]), "r")).toBe("finance");
    expect(await runLedgerModeTx(tx([]), "r")).toBe("finance");
    expect(await runLedgerModeTx(tx(undefined), "r")).toBe("finance");
  });
});
