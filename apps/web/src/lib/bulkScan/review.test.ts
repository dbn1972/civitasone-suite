import { describe, it, expect } from "vitest";
import {
  buildEditPayload, documentAmountMinor, draftFromDetail, isAmountMismatch, isDirty, isEditableTarget, nextWordIndex, parseTags, queueNeighbour, resolveShortcut,
  reviewPath, safeMaskedPreview,
} from "./review";
import { reviewDetail } from "./fixtures";
import type { ReviewQueueItem } from "./types";

describe("keyboard shortcuts", () => {
  it("maps the documented keys", () => {
    const k = (key: string, extra = {}) => resolveShortcut({ key, ...extra });
    expect([k("+"), k("="), k("-"), k("r"), k("R", { shiftKey: true }), k("f"), k("0"), k("["), k("]"), k("n"), k("p"), k("a"), k("e"), k("?"), k("1"), k("2")]).toEqual([
      "zoomIn", "zoomIn", "zoomOut", "rotate", "rotateBack", "fit", "fit", "prevPage", "nextPage", "nextFile", "prevFile", "approve", "edit", "help", "pickFirst", "pickSecond",
    ]);
    expect(k("x")).toBeNull();
  });
  it("never fires while typing in a field or with browser modifiers held", () => {
    expect(resolveShortcut({ key: "a", target: { tagName: "INPUT" } })).toBeNull();
    expect(resolveShortcut({ key: "a", target: { tagName: "textarea" } })).toBeNull();
    expect(resolveShortcut({ key: "a", target: { tagName: "SELECT" } })).toBeNull();
    expect(resolveShortcut({ key: "a", target: { tagName: "DIV", isContentEditable: true } })).toBeNull();
    expect(resolveShortcut({ key: "r", ctrlKey: true })).toBeNull();
    expect(resolveShortcut({ key: "a", metaKey: true })).toBeNull();
    expect(resolveShortcut({ key: "a", target: { tagName: "BUTTON" } })).toBe("approve");
    expect(isEditableTarget(null)).toBe(false);
  });
});

describe("navigation", () => {
  const q = (id: string): ReviewQueueItem => ({ batchId: "b", fileId: id, originalName: id, docType: null, confidence: null, reasons: [], piiFlags: [], pageCount: null, degradedPages: 0, batchName: null, updatedAt: "", version: 1 });
  it("finds neighbours and stops at the ends", () => {
    const list = [q("a"), q("b"), q("c")];
    expect(queueNeighbour(list, "b", 1)?.fileId).toBe("c");
    expect(queueNeighbour(list, "b", -1)?.fileId).toBe("a");
    expect(queueNeighbour(list, "c", 1)).toBeNull();
    expect(queueNeighbour(list, "a", -1)).toBeNull();
    expect(queueNeighbour(list, "zz", 1)).toBeNull();
    expect(reviewPath("b 1", "f/2")).toBe("/admin/bulk-scan/review/b%201/f%2F2");
  });
  it("roving word index", () => {
    expect(nextWordIndex(0, 3, "ArrowRight")).toBe(1);
    expect(nextWordIndex(2, 3, "ArrowRight")).toBe(2);
    expect(nextWordIndex(1, 3, "ArrowLeft")).toBe(0);
    expect(nextWordIndex(1, 3, "End")).toBe(2);
    expect(nextWordIndex(1, 3, "Home")).toBe(0);
    expect(nextWordIndex(1, 3, "x")).toBeNull();
    expect(nextWordIndex(0, 0, "ArrowRight")).toBeNull();
  });
});

describe("edit payload and optimistic version", () => {
  const d = reviewDetail();
  it("is null when nothing changed", () => {
    expect(buildEditPayload(d, draftFromDetail(d))).toBeNull();
    expect(isDirty(d, draftFromDetail(d))).toBe(false);
  });
  it("carries the loaded version and only what changed", () => {
    const draft = draftFromDetail(d);
    draft.docType = "pay_slip";
    expect(buildEditPayload(d, draft)).toEqual({ expectedVersion: 3, docType: "pay_slip" });
    const d2 = draftFromDetail(d);
    d2.fields[0]!.value = "02/02/1990";
    d2.tags = ["hr", "audit"];
    d2.text = { 1: "Service book of XXXX XXXX 1234", 2: "page TWO" };
    const p = buildEditPayload(d, d2)!;
    expect(p.expectedVersion).toBe(3);
    expect(p.fields?.[0]).toEqual({ kind: "date", value: "02/02/1990", pageNumber: 1 });
    expect(p.tags).toEqual(["hr", "audit"]);
    expect(p.text).toEqual([{ pageNumber: 2, text: "page TWO" }]);
  });
  it("parses tags: trims, dedupes and caps", () => {
    expect(parseTags(" a, b ,a,,c\nd")).toEqual(["a", "b", "c", "d"]);
    expect(parseTags(Array.from({ length: 30 }, (_, i) => `t${i}`).join(","))).toHaveLength(20);
  });
});

describe("PII defence in depth", () => {
  it("masks any digit run of 9 or more down to the last four", () => {
    expect(safeMaskedPreview("XXXX XXXX 1234")).toBe("XXXX XXXX 1234");
    expect(safeMaskedPreview("123456789012")).toBe("XXXXXXXX9012");
    expect(safeMaskedPreview("tel 98765432")).toBe("tel 98765432");
  });
});

describe("finance amount matching", () => {
  it("reads the extracted amount as paise, or rupees when typed with marks", () => {
    expect(documentAmountMinor([{ kind: "amount_inr", value: "125000" }])).toBe("125000");
    expect(documentAmountMinor([{ kind: "amount_inr", value: "₹1,250.00" }])).toBe("125000");
    expect(documentAmountMinor([{ kind: "date", value: "x" }])).toBeNull();
  });
  it("a finance candidate with a different amount is a mismatch; the server flag also counts; non-finance has no rule", () => {
    expect(isAmountMismatch({ target: "finance_payment", amountMinor: "125000", mismatch: false }, "125000")).toBe(false);
    expect(isAmountMismatch({ target: "finance_payment", amountMinor: "125001", mismatch: false }, "125000")).toBe(true);
    expect(isAmountMismatch({ target: "finance_bill", amountMinor: "125000", mismatch: true }, "125000")).toBe(true);
    expect(isAmountMismatch({ target: "finance_voucher", amountMinor: null, mismatch: false }, "125000")).toBe(false);
    expect(isAmountMismatch({ target: "hr_employee", amountMinor: "1", mismatch: false }, "125000")).toBe(false);
  });
});

describe("single-key shortcut preference (WCAG 2.1.4)", () => {
  it("is keyed per user, falling back to a per-browser key", async () => {
    const { shortcutsPrefKey } = await import("./review");
    expect(shortcutsPrefKey("u-1")).toBe("bulkScan.reviewShortcuts.u-1");
    expect(shortcutsPrefKey(null)).toBe("bulkScan.reviewShortcuts.browser");
    expect(shortcutsPrefKey("  ")).toBe("bulkScan.reviewShortcuts.browser");
  });
  it("defaults to on, reads off, and survives storage that throws or is missing", async () => {
    const { readShortcutsPref, writeShortcutsPref } = await import("./review");
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    expect(readShortcutsPref(storage, "k")).toBe(true);
    writeShortcutsPref(storage, "k", false);
    expect(readShortcutsPref(storage, "k")).toBe(false);
    writeShortcutsPref(storage, "k", true);
    expect(readShortcutsPref(storage, "k")).toBe(true);
    const bad = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    expect(readShortcutsPref(bad, "k")).toBe(true);
    expect(() => writeShortcutsPref(bad, "k", false)).not.toThrow();
    expect(readShortcutsPref(null, "k")).toBe(true);
  });
  it("never fires on text-entry widgets (by tag or ARIA role)", () => {
    expect(resolveShortcut({ key: "a", target: { tagName: "DIV", role: "textbox" } })).toBeNull();
    expect(resolveShortcut({ key: "a", target: { tagName: "DIV", role: "combobox" } })).toBeNull();
    expect(resolveShortcut({ key: "a", target: { tagName: "BUTTON" } })).toBe("approve");
  });
});
