import { describe, expect, it } from "vitest";
import type { AccountHealthEntry, CRMAccountSummary } from "@civitasone/types";
import { byUrgency, signalLabel, summariseWatchlist, withAccountNames } from "./health";

function entry(overrides: Partial<AccountHealthEntry> = {}): AccountHealthEntry {
  return {
    accountId: "11111111-1111-1111-1111-111111111111",
    score: 40,
    band: "at_risk",
    computedAt: "2026-08-01T10:00:00.000Z",
    ...overrides,
  };
}

function account(id: string, name: string): CRMAccountSummary {
  return { id, name, industry: null, website: null, parentId: null, contactCount: 0 };
}

describe("summariseWatchlist", () => {
  it("counts each band and averages the scores", () => {
    const summary = summariseWatchlist([
      entry({ accountId: "a", score: 10, band: "critical" }),
      entry({ accountId: "b", score: 20, band: "critical" }),
      entry({ accountId: "c", score: 45, band: "at_risk" }),
    ]);
    expect(summary.total).toBe(3);
    expect(summary.critical).toBe(2);
    expect(summary.atRisk).toBe(1);
    expect(summary.averageScore).toBe(25);
  });

  it("identifies the lowest-scoring account as the one to call first", () => {
    const summary = summariseWatchlist([
      entry({ accountId: "a", score: 30 }),
      entry({ accountId: "b", score: 8, band: "critical" }),
      entry({ accountId: "c", score: 44 }),
    ]);
    expect(summary.worst?.accountId).toBe("b");
  });

  it("breaks a tie on account id so the suggestion does not move between reloads", () => {
    const summary = summariseWatchlist([
      entry({ accountId: "zz", score: 12 }),
      entry({ accountId: "aa", score: 12 }),
    ]);
    expect(summary.worst?.accountId).toBe("aa");
  });

  it("returns zeroes and no worst account for an empty watchlist", () => {
    expect(summariseWatchlist([])).toEqual({
      total: 0,
      critical: 0,
      atRisk: 0,
      averageScore: 0,
      worst: null,
    });
  });
});

describe("withAccountNames", () => {
  it("joins account names onto the health rows", () => {
    const named = withAccountNames(
      [entry({ accountId: "acc-1" }), entry({ accountId: "acc-2" })],
      [account("acc-1", "Bharat Steel"), account("acc-2", "Deccan Textiles")],
    );
    expect(named.map((n) => n.accountName)).toEqual(["Bharat Steel", "Deccan Textiles"]);
  });

  it("keeps a row whose account is missing rather than hiding an at-risk account", () => {
    const named = withAccountNames([entry({ accountId: "ghost" })], []);
    expect(named).toHaveLength(1);
    expect(named[0].accountName).toBe("Unknown account");
  });
});

describe("byUrgency", () => {
  it("puts the lowest score first", () => {
    const rows = byUrgency(withAccountNames(
      [
        entry({ accountId: "acc-1", score: 48 }),
        entry({ accountId: "acc-2", score: 12 }),
        entry({ accountId: "acc-3", score: 30 }),
      ],
      [account("acc-1", "Alpha"), account("acc-2", "Beta"), account("acc-3", "Gamma")],
    ));
    expect(rows.map((r) => r.accountName)).toEqual(["Beta", "Gamma", "Alpha"]);
  });

  it("breaks equal scores on account name", () => {
    const rows = byUrgency(withAccountNames(
      [entry({ accountId: "acc-1", score: 20 }), entry({ accountId: "acc-2", score: 20 })],
      [account("acc-1", "Zeta"), account("acc-2", "Alpha")],
    ));
    expect(rows.map((r) => r.accountName)).toEqual(["Alpha", "Zeta"]);
  });

  it("does not mutate the input array", () => {
    const input = withAccountNames(
      [entry({ accountId: "acc-1", score: 50 }), entry({ accountId: "acc-2", score: 10 })],
      [account("acc-1", "Alpha"), account("acc-2", "Beta")],
    );
    const before = input.map((r) => r.accountId);
    byUrgency(input);
    expect(input.map((r) => r.accountId)).toEqual(before);
  });
});

describe("signalLabel", () => {
  it("maps known signals to readable labels", () => {
    expect(signalLabel("productUsage")).toBe("Product usage");
    expect(signalLabel("paymentTimeliness")).toBe("Payment timeliness");
  });

  it("falls back to the raw name for a signal it does not know", () => {
    expect(signalLabel("someNewSignal")).toBe("someNewSignal");
  });
});
