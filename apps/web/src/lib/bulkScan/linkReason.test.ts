import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import en from "@/messages/en.json";
import hi from "@/messages/hi.json";
import { amountDetailLine, describeLinkReason, parseLinkDetail } from "./linkReason";
import { LINK_REASON_CODES, describeReviewReason } from "./status";

type Tree = { [k: string]: string | Tree };
const E = ((en as unknown as Record<string, Tree>).bulkScan!.linkReason ?? {}) as Record<string, string>;
const H = ((hi as unknown as Record<string, Tree>).bulkScan!.linkReason ?? {}) as Record<string, string>;

/** The vocabulary shared with the target services (packages/scan-link): read from source so a new code can not ship without UI copy. */
function sharedCodes(): string[] | null {
  const p = join(__dirname, "../../../../../packages/scan-link/src/index.ts");
  if (!existsSync(p)) return null;
  const m = /export const LINK_REASON_CODES = \[([\s\S]*?)\] as const/.exec(readFileSync(p, "utf8"));
  return m ? [...m[1]!.matchAll(/"([A-Z_]+)"/g)].map((x) => x[1]!) : null;
}

describe("link reason copy", () => {
  it("every shared code has English and Hindi copy and maps to it from both entry points", () => {
    const shared = sharedCodes();
    expect(shared, "packages/scan-link LINK_REASON_CODES not found").not.toBeNull();
    expect(shared!.length).toBeGreaterThanOrEqual(13);
    for (const code of shared!) {
      expect(LINK_REASON_CODES as readonly string[], code).toContain(code);
      expect(E[code]?.length, `en ${code}`).toBeGreaterThan(5);
      expect(H[code]?.length, `hi ${code}`).toBeGreaterThan(5);
      expect(describeLinkReason(code)).toEqual({ kind: "code", key: `linkReason.${code}` });
      expect(describeReviewReason(`LINK_${code}`).key).toBe(`linkReason.${code}`);
    }
    expect(E.unknown && H.unknown).toBeTruthy();
  });
  it("an unknown code gets generic copy, never the raw code; reviewer text is shown as written", () => {
    expect(describeLinkReason("SOMETHING_NEW")).toEqual({ kind: "code", key: "linkReason.unknown" });
    expect(describeLinkReason("LINK_SOMETHING_NEW")).toEqual({ kind: "code", key: "linkReason.unknown" });
    expect(describeLinkReason("wrong person, retry later")).toEqual({ kind: "text", text: "wrong person, retry later" });
    expect(describeLinkReason(null)).toBeNull();
    expect(describeReviewReason("LINK_SOMETHING_NEW").key).toBe("linkReason.unknown");
  });
});

describe("amount mismatch detail", () => {
  it("keeps digit strings only and formats paise with rupee grouping, bigint-safe", () => {
    expect(parseLinkDetail({ expectedMinor: "125000", scannedMinor: "99999999999999999", other: "x" })).toEqual({ expectedMinor: "125000", scannedMinor: "99999999999999999" });
    expect(parseLinkDetail({ expectedMinor: "12.5", scannedMinor: "abc" })).toBeNull();
    expect(parseLinkDetail({ expectedMinor: 500 })).toEqual({ expectedMinor: "500" });
    expect(parseLinkDetail(null)).toBeNull();
    expect(parseLinkDetail([1])).toBeNull();
    expect(amountDetailLine({ expectedMinor: "125000", scannedMinor: "125001" })).toEqual({ expected: "₹1,250.00", scanned: "₹1,250.01" });
    expect(amountDetailLine({ expectedMinor: "123456789012345678", scannedMinor: "1" })?.expected).toBe("₹1,23,45,67,89,01,23,456.78");
    expect(amountDetailLine({ expectedMinor: "1" })).toBeNull();
    expect(amountDetailLine(null)).toBeNull();
  });
});
