import { describe, it, expect } from "vitest";
import {
  buildChequeTimeline, canCancelInstrument, canMarkStale, canRepresentInstrument, chequeStatusIcon, chequeStatusLabel,
  clearedDateLabel, INSTRUMENT_WRITE_ROLES, maskedAccountLabel, hasTimelineRows, istToday,
} from "./chequeUi";
import type { FinanceInstrumentSummary } from "@civitasone/types";

describe("cheque detail helpers (GAP-FINANCE-TREASURY-CHEQUES-DETAIL-04 / -06)", () => {
  it("maps each lifecycle status to its own icon, neutral note otherwise", () => {
    expect(chequeStatusIcon("cleared")).toBe("✅");
    expect(chequeStatusIcon("presented")).toBe("⏳");
    expect(chequeStatusIcon("bounced")).toBe("❌");
    expect(chequeStatusIcon("cancelled")).toBe("⛔");
    expect(chequeStatusIcon("issued")).toBe("📝");
    expect(chequeStatusIcon(null)).toBe("📝");
  });

  it("humanises the status for the stat card", () => {
    expect(chequeStatusLabel("bounced")).toBe("Bounced");
    expect(chequeStatusLabel("")).toBe("—");
  });

  it("offers Cancel only where finance-service allows it (issued)", () => {
    expect(canCancelInstrument("issued")).toBe(true);
    for (const s of ["presented", "cleared", "bounced", "cancelled", "", null, undefined]) {
      expect(canCancelInstrument(s)).toBe(false);
    }
  });

  it("is not offered to audit / budget roles", () => {
    expect(INSTRUMENT_WRITE_ROLES).not.toContain("audit_officer");
    expect(INSTRUMENT_WRITE_ROLES).toContain("finance_officer");
  });

  it("says 'Not cleared' for an expected absence and formats a real date", () => {
    expect(clearedDateLabel(null, "bounced")).toBe("Not cleared");
    expect(clearedDateLabel(null, "presented")).toBe("Not cleared");
    expect(clearedDateLabel("2025-03-05T10:00:00Z", "cleared")).toBe("05 Mar 2025");
  });
});

describe("cheque lifecycle actions (fp-finance-02)", () => {
  it("re-present is offered only for a bounced cheque", () => {
    expect(canRepresentInstrument("bounced")).toBe(true);
    for (const s of ["issued", "presented", "cleared", "cancelled", "stale", null, undefined, ""]) expect(canRepresentInstrument(s)).toBe(false);
  });

  it("mark stale needs an issued cheque strictly past its last valid day", () => {
    expect(canMarkStale("issued", "2026-04-10", "2026-04-10")).toBe(false);
    expect(canMarkStale("issued", "2026-04-10", "2026-04-11")).toBe(true);
    expect(canMarkStale("issued", null, "2026-04-11")).toBe(false);
    expect(canMarkStale("presented", "2026-04-10", "2026-05-01")).toBe(false);
    expect(canMarkStale("stale", "2026-04-10", "2026-05-01")).toBe(false);
  });

  it("stale gets its own icon", () => {
    expect(chequeStatusIcon("stale")).toBe("⌛");
  });

  it("masks the account from the last four digits only", () => {
    expect(maskedAccountLabel("6789")).toBe("XXXXXXXX6789");
    expect(maskedAccountLabel("123456789012")).toBe("XXXXXXXX9012");
    expect(maskedAccountLabel(null)).toBe("—");
    expect(maskedAccountLabel("12")).toBe("—");
  });
});

describe("buildChequeTimeline (GAP-FINANCE-TREASURY-CHEQUES-DETAIL-03)", () => {
  const base = {
    id: "i", instrumentType: "cheque", instrumentNo: "1", bankAccountId: null, bankName: "SBI", payee: "A", amountMinor: "1", currency: "INR",
    issueDate: "2026-01-02", status: "issued", presentedAt: null, clearedAt: null, bouncedAt: null, cancelledAt: null, bounceReason: null,
  } as FinanceInstrumentSummary;

  it("orders the steps chronologically and takes actors only from explicit ids", () => {
    const { rows, showActor } = buildChequeTimeline(
      { ...base, status: "cleared", issuedBy: "u1", presentedAt: "2026-01-05T10:00:00Z", presentedBy: "u2", bouncedAt: "2026-01-07T10:00:00Z", bounceReason: "Insufficient funds",
        lastRepresentedAt: "2026-01-09T10:00:00Z", representReason: "Funds arranged", lastRepresentedBy: "u2", clearedAt: "2026-01-10T10:00:00Z" },
      { u1: "Asha", u2: "Dev" },
    );
    expect(rows.map((r) => r.event)).toEqual([
      "Instrument issued", "Presented at bank", "Bounced — Insufficient funds", "Presented again — Funds arranged", "Cleared by bank",
    ]);
    expect(rows.map((r) => r.actor)).toEqual(["Asha", "Dev", null, "Dev", null]);
    expect(showActor).toBe(true);
  });

  it("shows no actor column for a cheque with no actor ids, and never invents one", () => {
    const { rows, showActor } = buildChequeTimeline({ ...base, status: "cancelled", cancelledAt: "2026-01-03T00:00:00Z", cancelReason: "Wrong payee" }, {});
    expect(showActor).toBe(false);
    expect(rows.every((r) => r.actor === null)).toBe(true);
    expect(rows[1]!.event).toBe("Cancelled — Wrong payee");
  });

  it("an actor id with no resolved name shows a short user label, never the raw uuid", () => {
    const { rows } = buildChequeTimeline({ ...base, issuedBy: "1a2b3c4d-0000-4000-8000-000000000000" }, {});
    expect(rows[0]!.actor).toBe("User 1a2b3c4d");
  });
});

describe("istToday / hasTimelineRows (fp-finance-02 review)", () => {
  it("uses the Indian calendar day: 20:00 UTC on 31 Mar is already 1 Apr in IST", () => {
    expect(istToday(new Date("2026-03-31T20:00:00Z"))).toBe("2026-04-01");
    expect(istToday(new Date("2026-03-31T18:29:59Z"))).toBe("2026-03-31");
    expect(istToday(new Date("2026-03-31T18:30:00Z"))).toBe("2026-04-01");
  });
  it("hasTimelineRows is true only for a non-empty timeline", () => {
    expect(hasTimelineRows({ rows: [] })).toBe(false);
    expect(hasTimelineRows({ rows: [{}] })).toBe(true);
  });
});
