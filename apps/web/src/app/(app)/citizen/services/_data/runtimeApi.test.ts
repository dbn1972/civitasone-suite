import { describe, expect, it, vi, afterEach } from "vitest";
import {
  buildDemandLines,
  buildTrackingTimeline,
  feeDisplay,
  formatExpectedByDate,
  formatFee,
  formatFeeExact,
  isTerminalStatus,
  journeyStepsForService,
  submitDraft,
  trackApplication,
  TrackingError,
  trackingLaneIndex,
  validateField,
} from "./runtimeApi";

describe("formatFeeExact", () => {
  it("formats paise as rupees", () => {
    expect(formatFeeExact(50000, "INR")).toBe("₹500");
  });

  it("handles missing fee", () => {
    expect(formatFeeExact(null, "INR")).toBe("Calculated on approval");
  });

  it("groups lakhs via shared formatMoney (bigint paise)", () => {
    expect(formatFeeExact(123456789, "INR")).toBe("₹12,34,567.89");
  });

  it("suffixes non-INR currency", () => {
    expect(formatFeeExact(150000, "USD")).toBe("₹1,500 USD");
  });
});

describe("formatFee", () => {
  it("prefixes 'from' and uses shared ₹ grouping", () => {
    expect(formatFee(150000, "INR")).toBe("from ₹1,500");
  });

  it("falls back to on-approval wording", () => {
    expect(formatFee(null, "INR")).toBe("Fee on approval");
  });
});

describe("feeDisplay", () => {
  it("returns structured onApproval when fee is null", () => {
    expect(feeDisplay(null, "INR")).toEqual({ kind: "onApproval", amount: null });
  });

  it("returns a shared-formatted amount with 'from' kind", () => {
    expect(feeDisplay(150000, "INR")).toEqual({ kind: "from", amount: "₹1,500" });
  });

  it("returns exact kind when requested", () => {
    expect(feeDisplay(0, "INR", true)).toEqual({ kind: "exact", amount: "₹0" });
  });
});

describe("formatExpectedByDate", () => {
  it("skips weekends when projecting SLA", () => {
    // Friday 7 Aug 2026 → 1 working day → Monday 10 Aug 2026
    const friday = new Date("2026-08-07T10:00:00Z");
    expect(formatExpectedByDate(1, friday)).toBe("10 Aug 2026");
  });

  it("returns null when SLA missing", () => {
    expect(formatExpectedByDate(null)).toBeNull();
  });
});

describe("journeyStepsForService", () => {
  it("omits fee when service has no fee", () => {
    expect(journeyStepsForService(false).map((s) => s.id)).toEqual(["form", "review", "submitted"]);
  });

  it("keeps fee when present", () => {
    expect(journeyStepsForService(true).map((s) => s.id)).toEqual(["form", "review", "fee", "submitted"]);
  });
});

describe("trackingLaneIndex", () => {
  it("maps statuses to lane indices", () => {
    expect(trackingLaneIndex("submitted", true)).toBe(0);
    expect(trackingLaneIndex("under_review", true)).toBe(1);
    expect(trackingLaneIndex("payment_due", true)).toBe(2);
    expect(trackingLaneIndex("issued", true)).toBe(3);
    expect(trackingLaneIndex("issued", false)).toBe(2);
  });
});

describe("buildTrackingTimeline", () => {
  it("builds certificate timeline with fee lane", () => {
    const steps = buildTrackingTimeline({
      status: "submitted",
      servicePattern: "certificate",
      acknowledgedAt: "2026-08-01T00:00:00.000Z",
      slaDays: 12,
      hasFee: true,
    });
    expect(steps.map((s) => s.id)).toEqual(["submitted", "review", "fee", "issued"]);
    expect(steps[0].state).toBe("current");
    expect(steps[0].date).toMatch(/2026/);
    expect(steps[0].slaDaysRemaining).toBeTypeOf("number");
  });

  it("omits fee for grievance and uses Resolved", () => {
    const steps = buildTrackingTimeline({
      status: "assigned",
      servicePattern: "grievance",
      hasFee: false,
    });
    expect(steps.map((s) => s.label)).toEqual(["Submitted", "Assigned", "Resolved"]);
    expect(steps[1].state).toBe("current");
  });

  it("marks all done when issued", () => {
    const steps = buildTrackingTimeline({ status: "issued", hasFee: true });
    expect(steps.every((s) => s.state === "done")).toBe(true);
  });

  it("advances past fee after payment", () => {
    const steps = buildTrackingTimeline({ status: "paid", hasFee: true });
    expect(steps.find((s) => s.id === "fee")?.state).toBe("done");
    expect(steps.find((s) => s.id === "issued")?.state).toBe("current");
  });
});

// GAP-...-APPLY-06: Aadhaar/PIN format validation.
describe("validateField aadhaar/pin (APPLY-06)", () => {
  it("rejects a short Aadhaar and accepts a 12-digit one", () => {
    expect(validateField("aadhaar_no", "1234", false)).toBeDefined();
    expect(validateField("aadhaar_no", "123412341234", false)).toBeUndefined();
    expect(validateField("aadhaar_no", "1234 1234 1234", false)).toBeUndefined();
  });
  it("rejects a bad PIN and accepts a 6-digit one", () => {
    expect(validateField("pincode", "12", false)).toBeDefined();
    expect(validateField("pincode", "751001", false)).toBeUndefined();
  });
  it("still enforces required and mobile/email", () => {
    expect(validateField("name", "", true)).toBe("This field is required.");
    expect(validateField("mobile_no", "12345", false)).toBeDefined();
  });
});

// GAP-...-APPLY-03: submitDraft must not fabricate a 'PENDING' tracking number.
describe("submitDraft tracking (APPLY-03)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("uses the trackingNo returned synchronously in the 202 body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 202,
        json: async () => ({ trackingNo: "CIT-2026-ABCD1234", applicationId: "app-1", status: "submitted", channel: "portal" }),
      })) as unknown as typeof fetch,
    );
    const ack = await submitDraft("draft-1");
    expect(ack.trackingNo).toBe("CIT-2026-ABCD1234");
    expect(ack.applicationId).toBe("app-1");
  });

  it("returns null tracking (NOT 'PENDING') when no number is issued yet", async () => {
    // submit 202 with empty body, then draft/app lookups miss
    const fetchMock = vi.fn(async (url: string) => {
      if (typeof url === "string" && url.endsWith("/submit")) {
        return { ok: true, status: 202, json: async () => ({ applicationId: "" }) };
      }
      // draft GET returns no applicationId
      return { ok: true, status: 200, json: async () => ({}) };
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    const ack = await submitDraft("draft-2");
    expect(ack.trackingNo).toBeNull();
    expect(ack.trackingNo).not.toBe("PENDING");
  });
});

describe("buildDemandLines", () => {
  it("returns a single application fee line", () => {
    const lines = buildDemandLines({
      name: "Trade License",
      feeFromMinor: 100000,
      feeCurrency: "INR",
    });
    expect(lines).toHaveLength(1);
    expect(lines[0].amountLabel).toBe("₹1,000");
    expect(lines[0].label).toContain("Trade License");
  });
});

// GAP-...-TRACK-01: a transient failure must not be reported as "number not found".
describe("trackApplication error classification", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("throws TrackingError not_found only for a 404", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 404 })) as unknown as typeof fetch);
    await expect(trackApplication("ABC")).rejects.toMatchObject({ kind: "not_found", status: 404 });
  });

  it("throws TrackingError unavailable for a 500", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500 })) as unknown as typeof fetch);
    await expect(trackApplication("ABC")).rejects.toMatchObject({ kind: "unavailable", status: 500 });
  });

  it("throws TrackingError unavailable for a network failure (never not_found)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNREFUSED"); }) as unknown as typeof fetch);
    const err = await trackApplication("ABC").catch((e) => e);
    expect(err).toBeInstanceOf(TrackingError);
    expect(err.kind).toBe("unavailable");
  });

  it("resolves the ack on success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ trackingNo: "T1", applicationId: "a1", status: "issued", channel: "portal" }),
      })) as unknown as typeof fetch,
    );
    await expect(trackApplication("T1")).resolves.toMatchObject({ trackingNo: "T1", status: "issued" });
  });
});

// GAP-...-TRACK-04: timeline last lane and the certificate/closure card agree.
describe("isTerminalStatus", () => {
  it("is true for every issued status (case/space/underscore-insensitive)", () => {
    for (const s of ["issued", "APPROVED", "completed", "closed", "RESOLVED", "confirmed", "under_review"]) {
      const terminal = isTerminalStatus(s);
      // all ISSUED_STATUSES are terminal; under_review is not
      if (s.toLowerCase().replace(/[\s_]+/g, "-") === "under-review") {
        expect(terminal).toBe(false);
      } else {
        expect(terminal).toBe(true);
      }
    }
  });

  it("agrees with trackingLaneIndex last lane for closed/resolved", () => {
    // closed/resolved are terminal -> last lane
    expect(isTerminalStatus("closed")).toBe(true);
    expect(trackingLaneIndex("closed", false)).toBe(2); // last lane (no fee: submitted/review/issued)
    expect(isTerminalStatus("resolved")).toBe(true);
    expect(trackingLaneIndex("resolved", true)).toBe(3);
  });
});
