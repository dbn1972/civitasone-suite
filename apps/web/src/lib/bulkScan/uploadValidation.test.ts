import { describe, it, expect, vi } from "vitest";
import { applyBatchLimits, checkFileSize, detectMime, sniffUpload, validateFile, type Candidate, type UploadLimits } from "./uploadValidation";

const bytes = (...n: number[]): Uint8Array => new Uint8Array(n);
const ascii = (s: string): Uint8Array => new Uint8Array([...s].map((c) => c.charCodeAt(0)));
const LIMITS: UploadLimits = { maxFileBytes: 1000, maxFilesPerBatch: 3, maxBatchBytes: 2000 };

describe("magic bytes", () => {
  it("detects PDF, PNG, JPEG and TIFF (both byte orders) by content, not name", () => {
    expect(detectMime(ascii("%PDF-1.7\n"))).toBe("application/pdf");
    expect(detectMime(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe("image/png");
    expect(detectMime(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe("image/jpeg");
    expect(detectMime(bytes(0x49, 0x49, 0x2a, 0x00))).toBe("image/tiff");
    expect(detectMime(bytes(0x4d, 0x4d, 0x00, 0x2a))).toBe("image/tiff");
    expect(detectMime(ascii("hello world"))).toBeNull();
  });
  it("rejects executables, SVG/HTML, empty and unknown content with distinct reasons", () => {
    expect(sniffUpload(bytes(0x4d, 0x5a, 0x90), null, 3)).toEqual({ ok: false, reason: "EXECUTABLE_CONTENT" });
    expect(sniffUpload(ascii("#!/bin/sh"), null, 9)).toEqual({ ok: false, reason: "EXECUTABLE_CONTENT" });
    expect(sniffUpload(ascii("<svg xmlns='x'/>"), null, 16)).toEqual({ ok: false, reason: "SVG_NOT_ALLOWED" });
    expect(sniffUpload(ascii("<!DOCTYPE html>"), null, 15)).toEqual({ ok: false, reason: "SVG_NOT_ALLOWED" });
    expect(sniffUpload(new Uint8Array(), null, 0)).toEqual({ ok: false, reason: "EMPTY_FILE" });
    expect(sniffUpload(ascii("plain text"), null, 10)).toEqual({ ok: false, reason: "UNSUPPORTED_FILE_TYPE" });
  });
  it("flags an encrypted PDF from the trailer but not text that merely contains Encrypted", () => {
    expect(sniffUpload(ascii("%PDF-1.4"), ascii("trailer << /Encrypt 5 0 R >>"), 5000)).toEqual({ ok: false, reason: "ENCRYPTED_PDF" });
    expect(sniffUpload(ascii("%PDF-1.4"), ascii("trailer << /EncryptedNote >>"), 5000)).toEqual({ ok: true, mime: "application/pdf" });
    expect(sniffUpload(ascii("%PDF-1.4"), null, 5000)).toEqual({ ok: true, mime: "application/pdf" });
  });
});

describe("limits", () => {
  it("size limit per file", () => {
    expect(checkFileSize(0, LIMITS)).toBe("EMPTY_FILE");
    expect(checkFileSize(1001, LIMITS)).toBe("FILE_TOO_LARGE");
    expect(checkFileSize(1000, LIMITS)).toBeNull();
  });
  const c = (key: string, size: number, reject: Candidate["reject"] = null): Candidate => ({ key, name: key, relPath: key, size, mime: "application/pdf", reject });
  it("count cap rejects the overflow in order, counting what the batch already holds", () => {
    const out = applyBatchLimits([c("a", 10), c("b", 10), c("c", 10)], { fileCount: 1, totalBytes: 0 }, LIMITS);
    expect(out.map((x) => x.reject)).toEqual([null, null, "TOO_MANY_FILES"]);
  });
  it("byte cap rejects a file that would exceed the total and keeps already-rejected ones", () => {
    const out = applyBatchLimits([c("a", 900), c("b", 900), c("x", 5, "ENCRYPTED_PDF" as never), c("d", 400)], { fileCount: 0, totalBytes: 0 }, { ...LIMITS, maxFilesPerBatch: 10 });
    expect(out.map((x) => x.reject)).toEqual([null, null, "ENCRYPTED_PDF", "BATCH_TOO_LARGE"]);
  });
});

describe("validateFile", () => {
  it("validates a real Blob end to end", async () => {
    const pdf = Object.assign(new Blob(["%PDF-1.4 hello"], { type: "application/pdf" }), { name: "a.pdf" });
    const r = await validateFile(pdf, "dir/a.pdf", { ...LIMITS, maxFileBytes: 5000 });
    expect(r).toMatchObject({ key: "dir/a.pdf|14", mime: "application/pdf", reject: null });
    const txt = Object.assign(new Blob(["just text"]), { name: "b.pdf" });
    expect((await validateFile(txt, "b.pdf", LIMITS)).reject).toBe("UNSUPPORTED_FILE_TYPE");
    const big = Object.assign(new Blob(["x".repeat(2000)]), { name: "c.pdf" });
    expect((await validateFile(big, "c.pdf", LIMITS)).reject).toBe("FILE_TOO_LARGE");
  });
});

describe("content hashing for resume", () => {
  it("sha256Hex matches node's SHA-256, attachHashes hashes valid files only, and a missing WebCrypto yields null", async () => {
    const { webcrypto, createHash } = await import("node:crypto");
    const { sha256Hex, attachHashes } = await import("./uploadValidation");
    vi.stubGlobal("crypto", webcrypto);
    const body = "%PDF-1.4 hello";
    const file = new File([body], "a.pdf", { type: "application/pdf" });
    expect(await sha256Hex(file)).toBe(createHash("sha256").update(body).digest("hex"));
    const cands = [
      { key: "a|14", name: "a.pdf", relPath: "a.pdf", size: 14, mime: "application/pdf" as const, reject: null },
      { key: "bad|1", name: "bad", relPath: "bad", size: 1, mime: null, reject: "UNSUPPORTED_FILE_TYPE" as const },
    ];
    const out = await attachHashes(cands, new Map([["a|14", file]]));
    expect(out[0]!.sha256).toBe(createHash("sha256").update(body).digest("hex"));
    expect(out[1]!.sha256).toBeUndefined();
    vi.stubGlobal("crypto", {});
    expect(await sha256Hex(file)).toBeNull();
    vi.unstubAllGlobals();
  });
  it("files above the cap are not hashed", async () => {
    const { sha256Hex, HASH_MAX_BYTES } = await import("./uploadValidation");
    const big = { size: HASH_MAX_BYTES + 1 } as unknown as Blob;
    expect(await sha256Hex(big)).toBeNull();
  });
});
