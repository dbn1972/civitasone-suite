/**
 * Money-precision hardening (release blocker): payroll money is bigint paise
 * end to end; the only places a value leaves bigint are the range-checked
 * converters in src/shared/money.ts. These tests pin their contract, and pin
 * the wire/JSON behaviour of the call sites that used a bare Number(<paise>).
 */
import { describe, it, expect } from "vitest";
import {
  minorFromDb, unsignedMinorFromDb, toSafeInt, minorToWireNumber, minorToRupees,
  divRoundHalfUp, roundMinorToRupees, formatRupees, formatRupeesIN,
} from "../src/shared/money.js";
import { serializeTransfer } from "../src/modules/disbursement-transfers/routes.js";
import type { DisbursementTransferRow } from "../src/modules/disbursement-transfers/schema.js";

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER); // 9_007_199_254_740_991 paise

describe("minorFromDb (strict decoding)", () => {
  it("decodes bigint, safe integers and base-10 integer strings exactly", () => {
    expect(minorFromDb(5n)).toBe(5n);
    expect(minorFromDb(12345)).toBe(12345n);
    expect(minorFromDb("9007199254740993")).toBe(9007199254740993n); // above 2^53, exact
    expect(minorFromDb("-250")).toBe(-250n);
  });

  it.each(["", " 12", "12.5", "1e3", "0x10", "1,000", "abc", "+5"])("rejects the non-integer string %j", (bad) => {
    expect(() => minorFromDb(bad)).toThrow(RangeError);
  });

  it("rejects floats, unsafe integers, NaN and non-numeric types instead of coercing", () => {
    expect(() => minorFromDb(12.5)).toThrow(RangeError);
    expect(() => minorFromDb(2 ** 53)).toThrow(RangeError);
    expect(() => minorFromDb(Number.NaN)).toThrow(RangeError);
    expect(() => minorFromDb(null)).toThrow(RangeError);
    expect(() => minorFromDb({})).toThrow(RangeError);
  });

  it("unsignedMinorFromDb uses /^\\d+$/ and reads a missing column as 0n", () => {
    expect(unsignedMinorFromDb("100")).toBe(100n);
    expect(unsignedMinorFromDb(null)).toBe(0n);
    expect(unsignedMinorFromDb(undefined)).toBe(0n);
    expect(() => unsignedMinorFromDb("-1")).toThrow(RangeError);
    expect(() => unsignedMinorFromDb(-1n)).toThrow(RangeError);
  });
});

describe("range-checked bigint -> number converters", () => {
  it("converts values inside the safe-integer range exactly", () => {
    expect(minorToWireNumber(MAX_SAFE)).toBe(Number.MAX_SAFE_INTEGER);
    expect(minorToWireNumber(-MAX_SAFE)).toBe(-Number.MAX_SAFE_INTEGER);
    expect(toSafeInt(0n)).toBe(0);
  });

  it("THROWS above 2^53-1 instead of silently rounding (the bug the bare Number() had)", () => {
    const tooBig = MAX_SAFE + 2n; // 9_007_199_254_740_993 -> Number() would give ...992
    expect(BigInt(Number(tooBig))).not.toBe(tooBig); // demonstrates the precision loss being guarded
    expect(() => minorToWireNumber(tooBig)).toThrow(RangeError);
    expect(() => toSafeInt(-tooBig)).toThrow(RangeError);
  });

  it("minorToRupees is the correctly-rounded double of the exact decimal, identical to paise/100 for ordinary amounts", () => {
    expect(minorToRupees(123456n)).toBe(1234.56);
    expect(minorToRupees(-5n)).toBe(-0.05);
    expect(minorToRupees(0n)).toBe(0);
    for (const p of [1n, 7n, 99n, 10n, 15_000_001n, 12_345_678n, 98_765_432_101n, 1_234_567_890_123n]) {
      expect(minorToRupees(p)).toBe(Number(p) / 100);
    }
    // never throws (the exact paise string travels beside this legacy float)
    expect(minorToRupees(MAX_SAFE + 2n)).toBeCloseTo(90071992547409.93, 1);
  });
});

describe("exact integer rounding", () => {
  it("divRoundHalfUp matches Math.round semantics (ties toward +infinity)", () => {
    for (const [n, d] of [[5, 2], [-5, 2], [7, 2], [-7, 2], [1, 3], [-1, 3], [149, 100], [150, 100], [-150, 100], [-151, 100], [0, 7]] as const) {
      expect(divRoundHalfUp(BigInt(n), BigInt(d))).toBe(BigInt(Math.round(n / d)));
    }
    expect(() => divRoundHalfUp(1n, 0n)).toThrow(RangeError);
  });

  it("roundMinorToRupees equals Math.round(paise / 100) for the whole sweep around each rupee", () => {
    for (let p = -350; p <= 350; p++) {
      expect(roundMinorToRupees(BigInt(p))).toBe(BigInt(Math.round(p / 100)));
    }
  });

  it("stays exact where the float path cannot (above 2^53 paise)", () => {
    expect(roundMinorToRupees(900_719_925_474_099_350n)).toBe(9_007_199_254_740_994n);
  });
});

describe("exact rupee formatting (bank files, payslips)", () => {
  it("formatRupees: two decimals, no float, sign preserved", () => {
    expect(formatRupees(0n)).toBe("0.00");
    expect(formatRupees(5n)).toBe("0.05");
    expect(formatRupees(123456n)).toBe("1234.56");
    expect(formatRupees(-5n)).toBe("-0.05");
    expect(formatRupees(-123400n)).toBe("-1234.00");
  });

  it("formatRupees is exact above 2^53 paise where (Number(p)/100).toFixed(2) is not", () => {
    const p = 9_007_199_254_740_993n; // 90071992547409.93 rupees
    expect(formatRupees(p)).toBe("90071992547409.93");
    expect((Number(p) / 100).toFixed(2)).not.toBe("90071992547409.93");
  });

  it("formatRupeesIN groups per the en-IN locale and matches the old float rendering for ordinary amounts", () => {
    for (const p of [0n, 5n, 99n, 100n, 123456n, 12345678n, 1234567890n, 98765432101n]) {
      const old = (Number(p) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      expect(formatRupeesIN(p)).toBe(old);
    }
    expect(formatRupeesIN(12345678n)).toBe("1,23,456.78");
    expect(formatRupeesIN(-12345678n)).toBe("-1,23,456.78");
  });
});

describe("API boundary: JSON serialisation of money (disbursement transfer response)", () => {
  const baseRow = {
    id: "00000000-0000-4000-8000-000000000001", runId: "00000000-0000-4000-8000-000000000002",
    employeeId: "00000000-0000-4000-8000-000000000003", employeeNo: "E1", beneficiaryName: "A B",
    accountLast4: "1234", ifsc: "SBIN0000001", status: "paid", fileFormat: "neft", fileReference: "F1",
    reasonText: null, reasonCode: null, attemptNo: 1,
  } as unknown as DisbursementTransferRow;

  it("emits the exact paise as a base-10 STRING and the legacy rupee float next to it", () => {
    const res = serializeTransfer({ ...baseRow, amountMinor: 123456789n } as DisbursementTransferRow);
    expect(res.amountPaise).toBe("123456789");
    expect(res.amountRupees).toBe(1234567.89);
    expect(JSON.parse(JSON.stringify(res))).toMatchObject({ amountPaise: "123456789", amountRupees: 1234567.89 });
  });

  it("a JSON.stringify of a raw bigint would throw -- the response must never carry one", () => {
    expect(() => JSON.stringify({ amountMinor: 1n })).toThrow(TypeError);
    const res = serializeTransfer({ ...baseRow, amountMinor: 1n } as DisbursementTransferRow);
    expect(() => JSON.stringify(res)).not.toThrow();
  });

  it("keeps the exact paise string authoritative beyond 2^53 paise (the rupee float is only its display twin)", () => {
    const res = serializeTransfer({ ...baseRow, amountMinor: MAX_SAFE + 2n } as DisbursementTransferRow);
    expect(res.amountPaise).toBe("9007199254740993"); // a float would have rounded to ...992
    expect(JSON.parse(JSON.stringify(res)).amountPaise).toBe("9007199254740993");
  });
});
