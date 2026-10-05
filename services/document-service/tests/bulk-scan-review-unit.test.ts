/** Pure-logic tests for the review / link / access helpers (no DB). */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { normalizeFieldValue, applyFieldEdits, auditFields, storedValue } from "../src/modules/bulk-scan/review-edit.js";
import { maskValue, maskFields, assemblePages, composeFinalText, snippetOf, MAX_WORDS_PER_PAGE } from "../src/modules/bulk-scan/review-view.js";
import { financeHintFromFields, isValidTargetId, buildLinkedDocumentMeta, isFinanceTarget } from "../src/modules/bulk-scan/links.js";
import { canReadFiledDocument, hasDocumentRole, TARGET_READ_ROLES } from "../src/modules/bulk-scan/access.js";
import { lookupQueryFor } from "../src/modules/bulk-scan/lookup-client.js";
import { editBody, approveBody, rejectBody, downloadQuery, searchQuery } from "../src/modules/bulk-scan/review-validators.js";
import { documentIdFor } from "../src/modules/bulk-scan/ids.js";
import { TRANSITIONS } from "../src/modules/bulk-scan/state.js";
import { SJ } from "./bulk-scan-review-helpers.js";

describe("field edits", () => {
  it("normalises per kind and rejects invalid values", () => {
    expect(normalizeFieldValue("date", "2026-02-28")).toBe("2026-02-28");
    expect(normalizeFieldValue("date", "2026-02-30")).toBeNull();
    expect(normalizeFieldValue("date", "28/02/2026")).toBeNull();
    expect(normalizeFieldValue("amount_inr", "1,500.50")).toBe("150050");
    expect(normalizeFieldValue("amount_inr", "1500")).toBe("1500");        // already minor units
    expect(normalizeFieldValue("amount_inr", "12.345")).toBeNull();
    expect(normalizeFieldValue("pan", "abcde1234f")).toBe("ABCDE1234F");
    expect(normalizeFieldValue("pan", "bad")).toBeNull();
    expect(normalizeFieldValue("ifsc", "sbin0001234")).toBe("SBIN0001234");
    expect(normalizeFieldValue("aadhaar", "1234 5678 9012")).toBe("123456789012");
    expect(normalizeFieldValue("email", "A@b.in")).toBe("a@b.in");
    expect(normalizeFieldValue("voucher_no", " v-1 ")).toBe("V-1");
  });

  it("replaces by kind (+page), appends new kinds, stores PII kinds masked only", () => {
    const existing = [{ kind: "date", value: "2020-01-01", raw: "x", confidence: 0.5, pageNumber: 1, bbox: null }, { kind: "date", value: "2020-02-02", raw: "y", confidence: 0.5, pageNumber: 2, bbox: null }];
    const out = applyFieldEdits(existing, [{ kind: "date", value: "2026-03-04", pageNumber: 2 }, { kind: "aadhaar", value: "1234 5678 9012" }]);
    expect(out.map((f) => [f.kind, f.value, f.pageNumber])).toEqual([["date", "2020-01-01", 1], ["date", "2026-03-04", 2], ["aadhaar", "XXXXXXXX9012", 1]]);
    expect(out[1]).toMatchObject({ manual: true, confidence: 1 });
    expect(JSON.stringify(out)).not.toContain("123456789012");
    expect(storedValue("phone", "9876543210")).toBe("XXXXXX3210");
    expect(() => applyFieldEdits([], [{ kind: "date", value: "nope" }])).toThrow(/INVALID_FIELD_VALUE/);
    expect(auditFields([{ kind: "pan", value: "ABCDE1234F", raw: "", confidence: 1, pageNumber: 1, bbox: null }])[0]?.value).toBe("XXXXXX234F");
  });
});

describe("masking + page assembly", () => {
  it("masks PII kinds (last 4), leaves masked / non-PII values alone", () => {
    expect(maskValue("aadhaar", "123412341234")).toBe("XXXXXXXX1234");
    expect(maskValue("aadhaar", "XXXX XXXX 1234")).toBe("XXXX XXXX 1234");
    expect(maskValue("email", "ravi@gov.in")).toBe("r***@gov.in");
    expect(maskValue("account_no", "1234")).toBe("XXXX");
    expect(maskValue("voucher_no", "V-100")).toBe("V-100");
    expect(maskFields([{ kind: "pan", value: "ABCDE1234F" } as never])[0]).toMatchObject({ value: "XXXXXX234F", raw: "XXXXXX234F" });
  });

  it("assembles pages from the stored JSON with overrides + image urls; bounds words; page extents from boxes", () => {
    const pages = assemblePages(SJ("hello"), { "1": "overridden" }, new Map([[1, "https://img"]]));
    expect(pages).toHaveLength(1);
    expect(pages[0]).toMatchObject({ pageNumber: 1, text: "overridden", imageUrl: "https://img", width: 300, height: 40 });
    expect(assemblePages(SJ("hello"), null, new Map())[0]).toMatchObject({ text: "hello", imageUrl: null });
    const many = SJ("x") as { pages: { blocks: { lines: { words: unknown[] }[] }[] }[] };
    many.pages[0]!.blocks[0]!.lines[0]!.words = Array.from({ length: MAX_WORDS_PER_PAGE + 50 }, (_, i) => ({ text: "w" + i, confidence: 1, bbox: { x0: 0, y0: 0, x1: 1, y1: 1 } }));
    expect(assemblePages(many, null, new Map())[0]?.words).toHaveLength(MAX_WORDS_PER_PAGE);
    expect(assemblePages(null, null, new Map())).toEqual([]);
  });

  it("composes final text (page overrides over page text, form-feed joined) and a bounded snippet", () => {
    const sj = { pages: [{ pageNumber: 1, text: "a" }, { pageNumber: 2, text: "b" }] };
    expect(composeFinalText(sj, { "2": "B2" })).toBe("a\fB2");
    expect(snippetOf("  a\n\n  b\tc ", 100)).toBe("a b c");
    expect(snippetOf("x".repeat(9000)).length).toBe(4000);
  });
});

describe("link helpers", () => {
  it("finance hint: best-confidence reference + amount in paise, null when absent/invalid", () => {
    expect(financeHintFromFields([
      { kind: "reference_no", value: "R-1", confidence: 0.4 }, { kind: "voucher_no", value: "V-9", confidence: 0.9 }, { kind: "amount_inr", value: "150000", confidence: 0.8 },
    ])).toEqual({ reference: "V-9", amountMinor: "150000" });
    expect(financeHintFromFields([{ kind: "amount_inr", value: "12.5", confidence: 1 }])).toEqual({ reference: null, amountMinor: null });
    expect(financeHintFromFields(null)).toEqual({ reference: null, amountMinor: null });
    expect(isFinanceTarget("finance_bill")).toBe(true);
    expect(isFinanceTarget("hr_employee")).toBe(false);
  });

  it("target ids are uuids; document id is deterministic per file", () => {
    expect(isValidTargetId("hr_employee", "22222222-2222-4222-8222-222222222222")).toBe(true);
    expect(isValidTargetId("hr_employee", "EMP-1")).toBe(false);
    expect(documentIdFor("a")).toBe(documentIdFor("a"));
    expect(documentIdFor("a")).not.toBe(documentIdFor("b"));
    expect(documentIdFor("a")).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("builds the masked target-side metadata (no raw text, bounded preview)", () => {
    const m = buildLinkedDocumentMeta({
      originalName: "a.pdf", mimeType: "application/pdf", docType: "letter", pageCount: 2, ocrMeanConfidence: "0.8123", piiFlags: ["aadhaar"], searchText: "y".repeat(900),
    } as never, { id: "b0b0b0b0-b0b0-40b0-80b0-b0b0b0b0b0b0" }, documentIdFor("f"), new Date("2026-10-04T00:00:00Z"));
    expect(m).toMatchObject({ fileName: "a.pdf", docType: "letter", pageCount: 2, ocrConfidence: 0.8123, piiFlags: ["aadhaar"], filedAt: "2026-10-04T00:00:00.000Z" });
    expect(m.textPreviewMasked).toHaveLength(500);
  });

  it("each target service gets its own lookup query names", () => {
    expect(lookupQueryFor({ target: "hr_employee", q: "E-1" }).toString()).toBe("employeeNo=E-1&name=E-1");
    expect(lookupQueryFor({ target: "hr_employee", q: "7" }).toString()).toBe("employeeNo=7");
    expect(lookupQueryFor({ target: "eoffice_file", q: "F/1" }).toString()).toBe("fileNo=F%2F1&subject=F%2F1");
    expect(lookupQueryFor({ target: "finance_bill", q: "B-1", amountMinor: "100" }).toString()).toBe("reference=B-1&amountMinor=100&kind=finance_bill");
  });
});

describe("access rules", () => {
  it("document roles read everything; target roles only with an active link of that kind", () => {
    expect(hasDocumentRole({ roles: ["document_admin"] })).toBe(true);
    expect(hasDocumentRole({ roles: ["document_user"] })).toBe(false);
    expect(canReadFiledDocument({ roles: ["hr_officer"] }, ["hr_employee"])).toBe(true);
    expect(canReadFiledDocument({ roles: ["hr_officer"] }, ["finance_bill"])).toBe(false);
    expect(canReadFiledDocument({ roles: ["hr_officer"] }, [])).toBe(false);
    expect(canReadFiledDocument({ roles: ["audit_officer"] }, ["eoffice_file"])).toBe(true);
    expect(Object.keys(TARGET_READ_ROLES).sort()).toEqual(["eoffice_file", "finance_bill", "finance_payment", "finance_voucher", "hr_employee"]);
  });
});

describe("request validation", () => {
  it("edit: strict, at least one change; approve/reject shapes; reject reason >= 5", () => {
    expect(editBody.safeParse({ expectedVersion: 1 }).success).toBe(false);
    expect(editBody.safeParse({ expectedVersion: 1, tags: ["a"] }).success).toBe(true);
    expect(editBody.safeParse({ expectedVersion: 1, tags: ["a"], extra: 1 }).success).toBe(false);
    expect(editBody.safeParse({ expectedVersion: 0, tags: ["a"] }).success).toBe(false);
    expect(approveBody.safeParse({ expectedVersion: 2, link: { target: "hr_employee", targetId: "x" } }).success).toBe(true);
    expect(approveBody.safeParse({ expectedVersion: 2, link: { target: "bogus", targetId: "x" } }).success).toBe(false);
    expect(rejectBody.safeParse({ expectedVersion: 1, reason: "abcd" }).success).toBe(false);
    expect(downloadQuery.parse({}).variant).toBe("original");
    expect(searchQuery.safeParse({ q: "a" }).success).toBe(false);
  });
});

describe("state machine + CQRS guards", () => {
  it("review paths use only existing transitions (needs_review/ready_to_file -> filed|skipped|needs_review)", () => {
    expect(TRANSITIONS.needs_review).toEqual(expect.arrayContaining(["ready_to_file", "skipped"]));
    expect(TRANSITIONS.ready_to_file).toEqual(expect.arrayContaining(["filed", "needs_review"]));
    expect(TRANSITIONS.filed).toEqual([]);
  });

  it("route files never write the database (routes publish commands; consumers write)", () => {
    const dir = join(__dirname, "../src/modules/bulk-scan");
    for (const f of readdirSync(dir).filter((x) => x.endsWith("routes.ts"))) {
      const src = readFileSync(join(dir, f), "utf8");
      expect(src, f).not.toMatch(/db\.transaction|(?<!app)\.(insert|update|delete)\(|markProcessed|enqueue\(/);
    }
  });
});
