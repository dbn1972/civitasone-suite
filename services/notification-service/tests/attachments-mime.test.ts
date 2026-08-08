/**
 * Notification Attachments — MIME Validation Domain Tests
 *
 * Module: services/notification-service/src/modules/attachments
 * Pack: Notification_Module_Test_Pack/04_Attachments_Test_Prompt.md
 *
 * Tests:
 *   1. detectMimeFromBuffer: magic byte detection for PDF, JPEG, PNG, GIF, ZIP, Office
 *   2. validateMime: happy paths (valid type + matching magic)
 *   3. validateMime: rejection (disallowed type, mismatched magic)
 *   4. Text/CSV fallback (no magic bytes — extension + declared MIME trusted)
 *   5. ZIP-based Office detection (docx/xlsx declare ZIP magic → allowed)
 *   6. ALLOWED_MIME_TYPES: all expected types present
 *   7. Security: disguised file (exe renamed to .pdf) caught by magic check
 */
import { describe, it, expect } from "vitest";
import { detectMimeFromBuffer, validateMime, ALLOWED_MIME_TYPES } from "../src/modules/attachments/mime.js";

// ─── Test data: file magic bytes ─────────────────────────────────────────────

const PDF_MAGIC = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2D, 0x31, 0x2E, 0x34]); // %PDF-1.4
const JPEG_MAGIC = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46]);
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
const GIF_MAGIC = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]); // GIF89a
const ZIP_MAGIC = Buffer.from([0x50, 0x4B, 0x03, 0x04]); // PK (docx/xlsx container)
const MSOFFICE_MAGIC = Buffer.from([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]); // DOC/XLS
const RANDOM_BYTES = Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07]); // unknown

// ─── 1. detectMimeFromBuffer ─────────────────────────────────────────────────

describe("detectMimeFromBuffer — magic byte detection", () => {
  it("detects PDF", () => expect(detectMimeFromBuffer(PDF_MAGIC)).toBe("application/pdf"));
  it("detects JPEG", () => expect(detectMimeFromBuffer(JPEG_MAGIC)).toBe("image/jpeg"));
  it("detects PNG", () => expect(detectMimeFromBuffer(PNG_MAGIC)).toBe("image/png"));
  it("detects GIF", () => expect(detectMimeFromBuffer(GIF_MAGIC)).toBe("image/gif"));
  it("detects ZIP (Office container)", () => expect(detectMimeFromBuffer(ZIP_MAGIC)).toBe("application/zip"));
  it("detects legacy MS Office (DOC/XLS)", () => expect(detectMimeFromBuffer(MSOFFICE_MAGIC)).toBe("application/msoffice"));
  it("returns null for unknown magic bytes", () => expect(detectMimeFromBuffer(RANDOM_BYTES)).toBeNull());
  it("returns null for empty buffer", () => expect(detectMimeFromBuffer(Buffer.alloc(0))).toBeNull());
  it("returns null for buffer shorter than shortest signature", () => expect(detectMimeFromBuffer(Buffer.from([0xFF, 0xD8]))).toBeNull());
});

// ─── 2. validateMime — valid uploads ─────────────────────────────────────────

describe("validateMime — valid file uploads", () => {
  it("PDF file with correct magic → valid", () => {
    const r = validateMime(PDF_MAGIC, "invoice.pdf", "application/pdf");
    expect(r.valid).toBe(true);
    expect(r.detectedMime).toBe("application/pdf");
  });

  it("JPEG image → valid", () => {
    const r = validateMime(JPEG_MAGIC, "photo.jpg", "image/jpeg");
    expect(r.valid).toBe(true);
  });

  it("PNG image → valid", () => {
    const r = validateMime(PNG_MAGIC, "screenshot.png", "image/png");
    expect(r.valid).toBe(true);
  });

  it("DOCX file (ZIP magic + declared docx MIME) → valid", () => {
    const r = validateMime(ZIP_MAGIC, "report.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    expect(r.valid).toBe(true);
    expect(r.detectedMime).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  });

  it("XLSX file (ZIP magic + declared xlsx MIME) → valid", () => {
    const r = validateMime(ZIP_MAGIC, "data.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(r.valid).toBe(true);
  });

  it("Legacy DOC file (msoffice magic + declared doc MIME) → valid", () => {
    const r = validateMime(MSOFFICE_MAGIC, "letter.doc", "application/msword");
    expect(r.valid).toBe(true);
  });
});

// ─── 3. validateMime — rejected uploads ──────────────────────────────────────

describe("validateMime — rejected file uploads", () => {
  it("unknown magic bytes with non-text extension → invalid", () => {
    const r = validateMime(RANDOM_BYTES, "payload.bin", "application/octet-stream");
    expect(r.valid).toBe(false);
  });

  it("disguised file: exe bytes in a .pdf extension → caught (unknown magic = invalid)", () => {
    // An EXE has MZ magic: 0x4D, 0x5A — not in our allowed signatures
    const exeMagic = Buffer.from([0x4D, 0x5A, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);
    const r = validateMime(exeMagic, "report.pdf", "application/pdf");
    expect(r.valid).toBe(false);
  });

  it("ZIP magic but declared as application/zip (not office) → not in ALLOWED_MIME_TYPES", () => {
    // application/zip is not in the ALLOWED_MIME_TYPES set directly
    // (only office ZIP formats are allowed via the special case)
    const r = validateMime(ZIP_MAGIC, "archive.zip", "application/zip");
    // ZIP magic detected, checked against ALLOWED_MIME_TYPES — "application/zip" is NOT in the set
    // But the code checks ALLOWED_MIME_TYPES.has(detected) which is "application/zip"...
    // Let's verify:
    expect(ALLOWED_MIME_TYPES.has("application/zip")).toBe(false);
    // So this should be invalid
    expect(r.valid).toBe(false);
  });
});

// ─── 4. Text/CSV fallback (no magic bytes) ───────────────────────────────────

describe("validateMime — text/CSV fallback", () => {
  it(".txt file with declared text/plain → valid (no magic check)", () => {
    const r = validateMime(Buffer.from("Hello world\n"), "notes.txt", "text/plain");
    expect(r.valid).toBe(true);
    expect(r.detectedMime).toBe("text/plain");
  });

  it(".csv file with declared text/csv → valid", () => {
    const r = validateMime(Buffer.from("name,email\nJohn,j@x.com\n"), "data.csv", "text/csv");
    expect(r.valid).toBe(true);
    expect(r.detectedMime).toBe("text/csv");
  });

  it(".txt file with wrong declared MIME → falls through to magic check", () => {
    // If you declare a .txt as application/pdf, text shortcut won't fire
    const r = validateMime(Buffer.from("Hello"), "notes.txt", "application/pdf");
    // Won't match text shortcut (declaredMime isn't text/plain)
    // Magic bytes won't match PDF either → invalid
    expect(r.valid).toBe(false);
  });
});

// ─── 5. ALLOWED_MIME_TYPES set ───────────────────────────────────────────────

describe("ALLOWED_MIME_TYPES — permitted upload types", () => {
  const expected = [
    "application/pdf", "image/jpeg", "image/png", "image/gif",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "video/mp4", "audio/mpeg", "text/plain", "text/csv",
  ];

  it("contains all expected types (12)", () => {
    expect(ALLOWED_MIME_TYPES.size).toBe(12);
    for (const mime of expected) {
      expect(ALLOWED_MIME_TYPES.has(mime)).toBe(true);
    }
  });

  it("does NOT contain executable types", () => {
    expect(ALLOWED_MIME_TYPES.has("application/x-executable")).toBe(false);
    expect(ALLOWED_MIME_TYPES.has("application/x-msdownload")).toBe(false);
    expect(ALLOWED_MIME_TYPES.has("application/javascript")).toBe(false);
  });

  it("does NOT contain raw ZIP (only office variants)", () => {
    expect(ALLOWED_MIME_TYPES.has("application/zip")).toBe(false);
  });
});
