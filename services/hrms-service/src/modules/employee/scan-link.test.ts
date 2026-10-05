import { describe, it, expect } from "vitest";
import { maskPreview } from "./scan-link-mask.js";
import { escapeLike, nameConfidence, nameTokens, candidateLabel } from "./scan-link-lookup.js";
import { rankCandidates } from "./scan-link-routes.js";

describe("maskPreview", () => {
  it("masks Aadhaar, PAN, phone, email and long numbers; keeps ordinary text; caps at 500", () => {
    expect(maskPreview("UID 1234 5678 9012 PAN ABCDE1234F ph +91 98765 43210 x@y.gov.in acct 123456789012345")).toBe(
      "UID [Aadhaar] PAN [PAN] ph [phone] [email] acct [number]");
    expect(maskPreview("Office order No. 45/2026")).toBe("Office order No. 45/2026");
    expect(maskPreview(null)).toBeNull();
    expect(maskPreview("a".repeat(900))).toHaveLength(500);
  });
});

describe("name scoring", () => {
  it("equal 0.9, all tokens 0.7, partial proportional <= 0.6, none 0", () => {
    expect(nameConfidence("rajesh kumar", "Rajesh Kumar")).toBe(0.9);
    expect(nameConfidence("rajesh kumar", "Rajesh Kumar Singh")).toBe(0.7);
    expect(nameConfidence("rajesh kumar", "Rajesh Verma")).toBe(0.3);
    expect(nameConfidence("rajesh kumar", "Priya Sharma")).toBe(0);
    expect(nameConfidence("   ", "Priya")).toBe(0);
  });
  it("tokenises, strips punctuation/diacritics and escapes LIKE metacharacters", () => {
    expect(nameTokens("R. Kumár-Singh")).toEqual(["kumar", "singh"]);
    expect(escapeLike("50%_\\")).toBe("50\\%\\_\\\\");
  });
});

describe("rankCandidates", () => {
  const rows = [
    { id: "1", employeeNo: "E1", fullName: "Rajesh Kumar" },
    { id: "2", employeeNo: "E2", fullName: "Rajesh Kumar Singh" },
    ...Array.from({ length: 8 }, (_, i) => ({ id: `x${i}`, employeeNo: `X${i}`, fullName: `Rajesh Other${i}` })),
  ];
  it("exact number is 1.0 and first; max 5; label shape", () => {
    const out = rankCandidates(rows, { employeeNo: "e2", name: "Rajesh Kumar" });
    expect(out[0]).toMatchObject({ targetId: "2", confidence: 1, label: candidateLabel("E2", "Rajesh Kumar Singh"), target: "hr_employee" });
    expect(out).toHaveLength(5);
    expect(out.slice(1).every((c) => c.confidence < 1)).toBe(true);
  });
});
