/**
 * R-RA-0087 — candidate resume versioning domain (pure).
 */
import { describe, it, expect } from "vitest";
import {
  nextResumeVersion, validateResumeUpload, resumeKeyPrefix, RESUME_MIME_TYPES, MAX_RESUME_BYTES,
} from "../src/modules/recruitment/resume-domain.js";

describe("nextResumeVersion", () => {
  it("starts at 1 for the first resume", () => {
    expect(nextResumeVersion([])).toBe(1);
  });
  it("is max+1, tolerating gaps from deletes", () => {
    expect(nextResumeVersion([1, 2, 3])).toBe(4);
    expect(nextResumeVersion([1, 4])).toBe(5); // gap at 2,3 — never re-use
    expect(nextResumeVersion([2])).toBe(3);
  });
});

describe("validateResumeUpload", () => {
  const ok = { fileKey: "s3://k", fileName: "cv.pdf", mimeType: "application/pdf", fileSizeBytes: 1024 };

  it("accepts a valid PDF/DOC/DOCX", () => {
    for (const mimeType of RESUME_MIME_TYPES) {
      expect(validateResumeUpload({ ...ok, mimeType })).toEqual([]);
    }
  });

  it("rejects an unsupported MIME type (server-side, not by extension)", () => {
    const errs = validateResumeUpload({ ...ok, mimeType: "image/png" });
    expect(errs.some((e) => e.includes("unsupported resume type"))).toBe(true);
  });

  it("rejects an empty file key or name", () => {
    expect(validateResumeUpload({ ...ok, fileKey: "" }).some((e) => e.includes("fileKey"))).toBe(true);
    expect(validateResumeUpload({ ...ok, fileName: "  " }).some((e) => e.includes("fileName"))).toBe(true);
  });

  it("rejects a non-positive or non-integer size", () => {
    expect(validateResumeUpload({ ...ok, fileSizeBytes: 0 }).some((e) => e.includes("positive integer"))).toBe(true);
    expect(validateResumeUpload({ ...ok, fileSizeBytes: -5 }).some((e) => e.includes("positive integer"))).toBe(true);
    expect(validateResumeUpload({ ...ok, fileSizeBytes: 1.5 }).some((e) => e.includes("positive integer"))).toBe(true);
  });

  it("rejects a file over the size limit", () => {
    const errs = validateResumeUpload({ ...ok, fileSizeBytes: MAX_RESUME_BYTES + 1 });
    expect(errs.some((e) => e.includes("limit"))).toBe(true);
  });

  it("accepts a file exactly at the size limit", () => {
    expect(validateResumeUpload({ ...ok, fileSizeBytes: MAX_RESUME_BYTES })).toEqual([]);
  });

  it("rejects a fileKey outside the candidate namespace (IDOR guard)", () => {
    const prefix = resumeKeyPrefix("cand-1");
    const good = validateResumeUpload({ ...ok, fileKey: `${prefix}v1.pdf`, expectedKeyPrefix: prefix });
    expect(good).toEqual([]);
    const bad = validateResumeUpload({ ...ok, fileKey: "candidates/other-cand/resumes/v1.pdf", expectedKeyPrefix: prefix });
    expect(bad.some((e) => e.includes("namespace"))).toBe(true);
  });
});

describe("resumeKeyPrefix", () => {
  it("scopes the key to the candidate id", () => {
    expect(resumeKeyPrefix("abc")).toBe("candidates/abc/resumes/");
  });
});
