import { describe, expect, it } from "vitest";
import { extractFields } from "../../src/post/extract.js";
import { detectPii, detectPiiInPages, maskText } from "../../src/post/pii.js";
import { generateAadhaar, verhoeffGenerate } from "../../src/post/verhoeff.js";
import { maskDocumentPages } from "../../src/output/mask.js";
import { DEFAULT_PII_POLICY, type PiiPolicy } from "../../src/types.js";
import { makePage } from "./helpers.js";

const AAD = generateAadhaar("23456789012");
const BAD = AAD.slice(0, 11) + String((Number(AAD[11]) + 1) % 10); // one misread digit: Verhoeff fails
const grp = (d: string, sep = " "): string => d.match(/\d{4}/g)!.join(sep);
const VID_PAYLOAD = "234567890123456".slice(0, 15);
const VID = VID_PAYLOAD + verhoeffGenerate(VID_PAYLOAD);
const ALL_MASK: PiiPolicy = { aadhaar: "mask", pan: "mask", bank_account: "mask", phone: "mask", email: "mask" };
const types = (text: string, opts = {}): string[] => detectPii([{ pageNumber: 1, text }], undefined, DEFAULT_PII_POLICY, opts).map((f) => f.type);

describe("Aadhaar-shaped numbers that fail Verhoeff are still PII (under-masking is the worse error)", () => {
  it("contiguous 12 digits, first digit 2-9, checksum bad", () => {
    const f = detectPii([{ pageNumber: 1, text: `UID ${BAD} end` }], undefined);
    expect(f.map((x) => [x.type, x.action])).toEqual([["aadhaar", "mask"]]); // same policy action as a valid Aadhaar
    expect(maskText(`UID ${BAD} end`, f)).toBe(`UID XXXX XXXX ${BAD.slice(-4)} end`);
    expect(types(`UID ${BAD}`, { strictAadhaar: true })).toEqual([]); // opt-out restores checksum-only
  });

  it("does not flag 12-digit numbers starting 0/1 (UIDAI never issues them)", () => {
    expect(types("ref 123456789012 and 012345678901")).toEqual([]);
  });

  it("groups split by two spaces, a hyphen+space, a newline or CRLF are found (valid and invalid)", () => {
    for (const d of [AAD, BAD]) {
      const [a, b, c] = d.match(/\d{4}/g)!;
      for (const text of [`${a}  ${b}  ${c}`, `${a}\n${b}\n${c}`, `${a}\r\n${b} ${c}`, `${a}- ${b} -${c}`, `${a}-${b}-${c}`]) {
        const f = detectPii([{ pageNumber: 1, text: `x ${text} y` }], undefined);
        expect(f.map((x) => x.type)).toEqual(["aadhaar"]);
        const masked = maskText(`x ${text} y`, f);
        expect(masked).toBe(`x XXXX XXXX ${d.slice(-4)} y`);
      }
    }
  });

  it("a line-break-split Aadhaar is masked in the page result (word boxes) as well as the text", () => {
    const page = makePage([`UID ${grp(AAD).slice(0, 9)}`, `${AAD.slice(8)} end`]);
    const findings = detectPiiInPages([page], ALL_MASK);
    expect(findings.map((f) => f.type)).toEqual(["aadhaar"]);
    const masked = maskDocumentPages([page], findings)[0]!;
    expect(masked.text).not.toContain(AAD.slice(0, 4));
    expect(masked.text).not.toContain(AAD.slice(4, 8));
    expect(JSON.stringify(masked.blocks)).not.toContain(AAD.slice(0, 4));
  });

  it("extractFields reports it with low confidence and masks value/raw under the default policy", () => {
    const f = extractFields([makePage([`UID ${BAD}`])]).find((x) => x.kind === "aadhaar");
    expect(f?.confidence).toBeLessThanOrEqual(0.4);
    expect(f?.raw).toBe(`XXXX XXXX ${BAD.slice(-4)}`);
    expect(f?.value).not.toContain(BAD.slice(0, 8));
  });
});

describe("16-digit VIDs", () => {
  it("detected as aadhaar (contiguous, 4-4-4-4, double-space, newline) and previewed as last-4 only", () => {
    for (const text of [VID, grp(VID), grp(VID, "  "), grp(VID, "\n"), grp(VID, "-")]) {
      const f = detectPii([{ pageNumber: 1, text: `VID ${text} ok` }], undefined);
      expect(f.map((x) => [x.type, x.action])).toEqual([["aadhaar", "mask"]]);
      expect(f[0]?.maskedPreview).toBe(`XXXX XXXX XXXX ${VID.slice(-4)}`);
      expect(maskText(`VID ${text} ok`, f)).toBe(`VID XXXX XXXX XXXX ${VID.slice(-4)} ok`);
    }
  });

  it("a checksum-bad 16-digit shape is still flagged, unless strictAadhaar", () => {
    const bad = VID.slice(0, 15) + String((Number(VID[15]) + 1) % 10);
    expect(types(`v ${grp(bad)}`)).toEqual(["aadhaar"]);
    expect(types(`v ${grp(bad)}`, { strictAadhaar: true })).toEqual([]);
    expect(types(`v ${grp(VID)}`, { strictAadhaar: true })).toEqual(["aadhaar"]);
  });

  it("a valid 12-digit Aadhaar followed by an unrelated 4-digit number keeps the 12-digit span", () => {
    const text = `${grp(AAD)}\n2026`;
    const f = detectPii([{ pageNumber: 1, text }], undefined);
    expect(f).toHaveLength(1);
    expect(text.slice(f[0]!.start, f[0]!.end)).toBe(grp(AAD));
  });
});

describe("false-positive trade-off: common numbers are NOT all masked", () => {
  it("phone numbers stay phones (flag), never Aadhaar", () => {
    for (const text of ["call 9876543210", "call +91 98765 43210", "call +91-9876543210", "call 919876543210", "tel 011-23456789"]) {
      const t = types(text);
      expect(t).not.toContain("aadhaar");
    }
    expect(types("call 919876543210")).toEqual(["phone"]);
  });

  it("amounts with thousands separators / decimals and short numbers are untouched", () => {
    for (const text of [
      "Rs. 2,50,00,00,000", "Rs. 250,000,000,000", "total 250000000000.50", "total 2,50000000000", "rate 2345.6789 x 1234",
      "Pin 560001, pages 2345", "date 12/03/2024 no. 4567 8901", "id 98765 43210",
    ]) expect(types(text)).toEqual(types(text).filter((t) => t !== "aadhaar"));
  });

  it("a 12-digit number glued to a longer number or to a decimal tail is not an Aadhaar", () => {
    expect(types(`n ${BAD}9`)).toEqual([]);
    expect(types(`n 1${BAD}`)).toEqual([]);
    expect(types(`n ${BAD}.50`)).toEqual([]);
    expect(types(`n 7,${BAD}`)).toEqual([]);
  });

  it("known accepted over-detection: other 12-digit ids starting 2-9 are reported (documented), and strict mode drops them; real timestamps/year runs are excluded", () => {
    expect(types("stamp 345678901234")).toEqual(["aadhaar"]);
    expect(types("stamp 345678901234", { strictAadhaar: true })).toEqual([]);
    expect(types("stamp 202610041530")).toEqual([]);
  });
});
