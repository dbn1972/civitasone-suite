import { PDFDocument, PDFName } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { OcrChain } from "../src/chain.js";
import { OcrInputError } from "../src/errors.js";
import { pdfEncryptInTrailer, pdfLooksEncrypted, PdfSource } from "../src/preprocess/index.js";
import { processDocument } from "../src/process.js";
import { encryptedPdf } from "./encryptedPdf.js";
import { fakeProvider, pageResult } from "./helpers.js";

const chain = (): OcrChain => new OcrChain({ providers: [{ provider: fakeProvider("tesseract", (_c, ps) => ps.map((p) => pageResult(p, 0.9))) }], langs: ["eng"] });

describe("encrypted PDF detection uses pdfjs, not a byte scan", () => {
  it("does NOT reject a normal PDF that merely contains the literal /Encrypt (document info string)", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([200, 200]);
    doc.setTitle("how to set /Encrypt in a trailer");
    doc.setKeywords(["/Encrypt 5 0 R"]);
    doc.context.register(doc.context.stream("% /Encrypt appears in this stream too"));
    const bytes = await doc.save({ useObjectStreams: false });
    expect(pdfLooksEncrypted(bytes)).toBe(true); // the cheap scan alone would have rejected it
    expect(pdfEncryptInTrailer(bytes)).toBe(false);
    const pdf = await PdfSource.open(bytes);
    expect(pdf.pageCount).toBe(1);
    await pdf.close();
    const out = await processDocument({ data: bytes }, { chain: chain(), orientationDetector: null });
    expect(out.result.pageCount).toBe(1);
  }, 60_000);

  it("rejects a real RC4-encrypted PDF that needs a user password with ENCRYPTED_PDF", async () => {
    const enc = encryptedPdf("s3cret");
    const err = await PdfSource.open(enc).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OcrInputError);
    expect((err as OcrInputError).code).toBe("ENCRYPTED_PDF");
    expect((err as OcrInputError).message).toMatch(/owner/i); // copy mentions owner-password-only PDFs
    await expect(processDocument({ data: enc }, { chain: chain(), orientationDetector: null })).rejects.toMatchObject({ code: "ENCRYPTED_PDF" });
  });

  it("accepts an owner-password-only PDF (empty user password) because pdfjs can open it", async () => {
    const pdf = await PdfSource.open(encryptedPdf(""));
    expect(pdf.pageCount).toBe(1);
    await pdf.close();
  });

  it("reports an unparseable file with an /Encrypt trailer entry as ENCRYPTED_PDF, and plain garbage as CORRUPT", async () => {
    const stub = Buffer.from("%PDF-1.6\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R/Encrypt 5 0 R/Size 6>>\nstartxref\n0\n%%EOF");
    await expect(PdfSource.open(stub)).rejects.toMatchObject({ code: "ENCRYPTED_PDF" });
    await expect(PdfSource.open(Buffer.from("%PDF-1.4\nnot a pdf /Encrypt in the middle of junk\nmore junk"))).rejects.toMatchObject({ code: "CORRUPT" });
  });

  it("(sanity) pdf-lib output has no Encrypt entry", async () => {
    const doc = await PDFDocument.create();
    doc.addPage();
    expect(doc.context.trailerInfo.Encrypt).toBeUndefined();
    expect(PDFName.of("Encrypt")).toBeDefined();
  });
});
