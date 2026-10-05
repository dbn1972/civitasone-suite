import { describe, expect, it } from "vitest";
import {
  detectPii, detectPiiInPages, distinctPiiTypes, maskText, redactImage, scrubForLog, scrubString,
} from "../../src/post/pii.js";
import { generateAadhaar } from "../../src/post/verhoeff.js";
import { DEFAULT_PII_POLICY, type PiiPolicy } from "../../src/types.js";
import { makePage } from "./helpers.js";

const AAD = generateAadhaar("23456789012");
const AAD_SP = `${AAD.slice(0, 4)} ${AAD.slice(4, 8)} ${AAD.slice(8)}`;
const PAN = "ABCPE1234F";
const ALL_MASK: PiiPolicy = { aadhaar: "mask", pan: "mask", bank_account: "mask", phone: "mask", email: "mask" };

describe("detectPii", () => {
  const text = `Aadhaar ${AAD_SP}. PAN ${PAN}. A/c No. 123456789012. Call +91 98765 43210 or mail a.b@x.gov.in`;
  it("finds all five types with default policy actions and NEVER carries raw values", () => {
    const f = detectPii([{ pageNumber: 1, text }], undefined);
    expect(distinctPiiTypes(f)).toEqual(["aadhaar", "bank_account", "email", "pan", "phone"]);
    expect(f.find((x) => x.type === "aadhaar")?.action).toBe("mask");
    expect(f.find((x) => x.type === "pan")?.action).toBe("flag");
    const json = JSON.stringify(f);
    for (const raw of [AAD, AAD_SP, PAN, "123456789012", "9876543210", "98765 43210", "a.b@x.gov.in"]) expect(json).not.toContain(raw);
    expect(f.find((x) => x.type === "aadhaar")?.maskedPreview).toBe(`XXXX XXXX ${AAD.slice(-4)}`);
  });
  it("offsets point at the original span", () => {
    const f = detectPii([{ pageNumber: 1, text }], undefined).find((x) => x.type === "pan");
    expect(text.slice(f?.start, f?.end)).toBe(PAN);
  });
  it("checksum-failing Aadhaar-shaped numbers (contiguous or grouped) are still flagged; strictAadhaar restores checksum-only", () => {
    const bad = AAD.slice(0, 11) + String((Number(AAD[11]) + 1) % 10);
    const grouped = `${bad.slice(0, 4)} ${bad.slice(4, 8)} ${bad.slice(8)}`;
    expect(detectPii([{ pageNumber: 1, text: `n ${bad}` }], undefined).map((x) => [x.type, x.action])).toEqual([["aadhaar", "mask"]]);
    expect(detectPii([{ pageNumber: 1, text: `n ${bad}` }], undefined, DEFAULT_PII_POLICY, { strictAadhaar: true })).toHaveLength(0);
    expect(detectPii([{ pageNumber: 1, text: `n ${grouped}` }], undefined).map((x) => x.type)).toEqual(["aadhaar"]);
    expect(detectPii([{ pageNumber: 1, text: `n ${grouped}` }], undefined, DEFAULT_PII_POLICY, { strictAadhaar: true })).toHaveLength(0);
  });
  it("maps bbox from word boxes (record or Map)", () => {
    const page = makePage([`UID ${AAD_SP} end`]);
    const words = page.blocks[0]?.lines[0]?.words ?? [];
    const viaRecord = detectPii([{ pageNumber: 1, text: page.text }], { 1: words });
    const viaMap = detectPii([{ pageNumber: 1, text: page.text }], new Map([[1, words]]));
    expect(viaRecord[0]?.bbox).not.toBeNull();
    expect(viaMap[0]?.bbox).toEqual(viaRecord[0]?.bbox);
    expect(detectPiiInPages([page])[0]?.bbox).toEqual(viaRecord[0]?.bbox);
  });
  it("devanagari digits are detected too", () => {
    const deva = [...AAD].map((c) => String.fromCharCode(0x0966 + Number(c))).join("");
    expect(detectPii([{ pageNumber: 1, text: `आधार ${deva}` }], undefined).map((x) => x.type)).toEqual(["aadhaar"]);
  });
});

describe("maskText", () => {
  const text = `Aadhaar ${AAD_SP}. PAN ${PAN}. mail a.b@x.gov.in`;
  it("applies only mask/redact actions", () => {
    const f = detectPii([{ pageNumber: 1, text }], undefined);
    const out = maskText(text, f);
    expect(out).toContain(`XXXX XXXX ${AAD.slice(-4)}`);
    expect(out).not.toContain(AAD_SP);
    expect(out).toContain(PAN); // flag only
    expect(out).toContain("a.b@x.gov.in");
  });
  it("redact removes the value; mask-all masks everything; page filter respected", () => {
    const f = detectPii([{ pageNumber: 1, text }], undefined, { ...ALL_MASK, pan: "redact" });
    const out = maskText(text, f, 1);
    expect(out).toContain("[REDACTED]");
    for (const raw of [AAD_SP, PAN, "a.b@x.gov.in"]) expect(out).not.toContain(raw);
    expect(maskText(text, f, 2)).toBe(text);
  });
  it("is idempotent-safe on overlapping/out-of-range findings", () => {
    const f = detectPii([{ pageNumber: 1, text }], undefined, ALL_MASK);
    expect(() => maskText("short", f)).not.toThrow();
  });
});

describe("redactImage (sharp)", () => {
  it("paints opaque boxes for redact findings and reports unlocatable ones", async () => {
    const sharpMod = (await import("sharp")) as unknown as { default: (o: unknown) => { png(): { toBuffer(): Promise<Buffer> } } };
    const white = await sharpMod.default({ create: { width: 200, height: 100, channels: 3, background: "#ffffff" } }).png().toBuffer();
    const r = await redactImage(white, [
      { type: "pan", pageNumber: 1, start: 0, end: 10, bbox: { x0: 20, y0: 20, x1: 80, y1: 40 }, action: "redact", maskedPreview: "x" },
      { type: "pan", pageNumber: 1, start: 0, end: 10, bbox: null, action: "redact", maskedPreview: "x" },
      { type: "pan", pageNumber: 1, start: 0, end: 10, bbox: { x0: 120, y0: 60, x1: 180, y1: 80 }, action: "flag", maskedPreview: "x" },
    ]);
    expect(r.redacted).toBe(1);
    expect(r.unlocatable).toBe(1);
    const sharp2 = (await import("sharp")) as unknown as { default: (b: Uint8Array) => { raw(): { toBuffer(o: unknown): Promise<{ data: Buffer; info: { width: number; channels: number } }> } } };
    const { data, info } = await sharp2.default(r.data).raw().toBuffer({ resolveWithObject: true });
    const px = (x: number, y: number): number => data[(y * info.width + x) * info.channels] ?? -1;
    expect(px(40, 30)).toBe(0);     // inside redact box: black
    expect(px(150, 70)).toBe(255);  // flag-only box untouched
    expect(px(5, 5)).toBe(255);
  });
});

describe("log scrubbing: raw PII never survives", () => {
  const sample = {
    msg: `failed for ${AAD} / ${AAD_SP} pan ${PAN} acct 123456789012 ph 9876543210 +91 98765 43210 e a.b@x.gov.in`,
    nested: [{ deep: { v: `x ${AAD}` } }, `PAN:${PAN}`],
    err: new Error(`bad Aadhaar ${AAD}`),
    m: new Map([["k", `v ${PAN}`]]),
  };
  const cyc: Record<string, unknown> = { a: `x ${AAD}` };
  cyc["self"] = cyc;
  it("scrubs deeply (objects, arrays, errors, maps, cycles)", () => {
    const out = JSON.stringify(scrubForLog(sample));
    for (const raw of [AAD, AAD_SP, PAN, "123456789012", "9876543210", "98765 43210", "a.b@x.gov.in"]) expect(out).not.toContain(raw);
    expect(out).toContain(AAD.slice(-4));
    const scrubbedCyc = scrubForLog(cyc);
    expect(scrubbedCyc["self"]).toBe(scrubbedCyc);
    expect(String(scrubbedCyc["a"])).not.toContain(AAD);
  });
  it("does not mutate the input", () => {
    scrubForLog(sample);
    expect(sample.msg).toContain(AAD);
  });
  it("leaves ordinary strings and numbers alone", () => {
    expect(scrubForLog({ a: "hello 12 pages", n: 42, ok: true, d: "2024-03-12" })).toEqual({ a: "hello 12 pages", n: 42, ok: true, d: "2024-03-12" });
    expect(scrubString("Rs. 1,23,456")).toBe("Rs. 1,23,456");
  });
  it("JSON of findings built from a page containing PII contains none of it", () => {
    const f = detectPii([{ pageNumber: 1, text: sample.msg }], undefined, ALL_MASK);
    const json = JSON.stringify(f);
    for (const raw of [AAD, PAN, "9876543210", "a.b@x.gov.in"]) expect(json).not.toContain(raw);
  });
});

describe("log scrubbing: numbers and digit groups", () => {
  it("scrubs numeric values of 9+ digits (e.g. an Aadhaar/account logged as a number), keeps small numbers", () => {
    const out = scrubForLog({ aadhaar: 234567890123, account: 123456789012345, small: 12345678, n: 42, nested: [987654321], f: 3.14 });
    const json = JSON.stringify(out);
    expect(json).not.toContain("234567890123");
    expect(json).not.toContain("123456789012345");
    expect(json).not.toContain("987654321");
    expect(out.aadhaar).toBe("XXXX XXXX 0123");
    expect(out.small).toBe(12345678);
    expect(out.n).toBe(42);
    expect(out.f).toBe(3.14);
    expect(scrubForLog(2345678901234567n)).toBe("XXXX XXXX XXXX 4567");
  });

  it("keeps at most the last 4 digits of 16-digit groups (VID / card), however grouped", () => {
    for (const s of ["1234 5678 9012 3456", "1234-5678-9012-3456", "1234567890123456", "1234  5678  9012  3456", "1234\n5678\n9012\n3456"]) {
      const out = scrubString(`v ${s} end`);
      expect(out).toBe("v XXXX XXXX XXXX 3456 end");
    }
    expect(scrubString("a/c 1234 5678 9012 3456")).not.toMatch(/9012|5678/);
  });

  it("12-digit groups split by two spaces or a line break are scrubbed", () => {
    expect(scrubString("2345  6789  0123")).toBe("XXXX XXXX 0123");
    expect(scrubString("2345\n6789\n0123")).toBe("XXXX XXXX 0123");
  });
});
