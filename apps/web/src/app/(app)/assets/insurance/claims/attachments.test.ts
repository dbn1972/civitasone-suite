import { describe, it, expect } from "vitest";
import { addAttachment, removeAttachment, formatFileSize, parseAttachments, MAX_CLAIM_ATTACHMENTS, type ClaimAttachment } from "./attachments";

const att = (n: number): ClaimAttachment => ({ key: `uploads/t/attachment/${n}.pdf`, fileName: `f${n}.pdf`, size: 1024, mimeType: "application/pdf" });

describe("claim attachments (GAP-ASSETS-INSURANCE-CLAIMS-06)", () => {
  it("adds, de-duplicates by key and stops at the cap", () => {
    let list: ClaimAttachment[] = [];
    for (let i = 0; i < MAX_CLAIM_ATTACHMENTS + 2; i++) list = addAttachment(list, att(i));
    expect(list).toHaveLength(MAX_CLAIM_ATTACHMENTS);
    expect(addAttachment(list, att(0))).toHaveLength(MAX_CLAIM_ATTACHMENTS);
    expect(addAttachment([att(1)], att(1))).toHaveLength(1);
  });
  it("removes by key", () => {
    expect(removeAttachment([att(1), att(2)], att(1).key).map((a) => a.fileName)).toEqual(["f2.pdf"]);
  });
  it("formats sizes", () => {
    expect(formatFileSize(512)).toBe("512 B");
    expect(formatFileSize(2048)).toBe("2.0 KB");
    expect(formatFileSize(1.5 * 1024 * 1024)).toBe("1.5 MB");
    expect(formatFileSize(-1)).toBe("—");
  });
  it("parses a server payload defensively", () => {
    expect(parseAttachments(null)).toEqual([]);
    expect(parseAttachments([att(1), { key: 5 }, "x"])).toEqual([att(1)]);
    expect(parseAttachments([{ key: "k", fileName: "a" }])).toEqual([{ key: "k", fileName: "a", size: 0, mimeType: "" }]);
  });
});
