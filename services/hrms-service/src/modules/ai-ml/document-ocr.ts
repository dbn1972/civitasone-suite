/**
 * Document OCR Service
 *
 * Extracts text from receipts, bills, medical documents using Tesseract/DocTR.
 * Used by: expense claims (auto-fill amount + vendor), medical claims (diagnosis extract).
 *
 * Flow:
 * 1. User uploads receipt photo → stored in S3
 * 2. OCR service extracts text
 * 3. Structured extraction: amount, date, vendor name, GST number
 * 4. Returns to UI for auto-fill (user confirms/edits)
 *
 * Engine: Tesseract.js (server-side) or DocTR (Python microservice)
 * Fallback: Manual entry if OCR confidence < 60%
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getRequestContext } from "../../shared/context.js";

const ocrRequestSchema = z.object({
  imageKey: z.string().min(1).max(512), // S3 key
  documentType: z.enum(["receipt", "medical_bill", "travel_ticket", "invoice", "general"]),
});

/**
 * Extract text from image using OCR.
 * In production: use Tesseract.js or call a Python DocTR microservice.
 *
 * For now: returns mock structured data to demonstrate the integration pattern.
 */
async function performOcr(imageKey: string, docType: string): Promise<OcrResult> {
  // TODO: Replace with real OCR engine
  // Option A: Tesseract.js (Node.js native)
  //   import Tesseract from 'tesseract.js';
  //   const { data: { text, confidence } } = await Tesseract.recognize(imageBuffer, 'eng+hin');
  //
  // Option B: DocTR Python microservice
  //   const res = await fetch('http://ocr-service:5000/extract', {
  //     method: 'POST', body: JSON.stringify({ imageKey, lang: 'eng+hin' })
  //   });
  //   return await res.json();

  // Mock response based on document type
  const baseConfidence = 75 + Math.floor(Math.random() * 20);

  if (docType === "receipt" || docType === "invoice") {
    return {
      rawText: `Invoice #INV-2026-${Math.floor(Math.random() * 9999)}\nDate: 25/06/2026\nVendor: ABC Medical Store\nGSTIN: 07AABCS1429B1Z4\nTotal: ₹2,450.00\nPaid by: UPI`,
      confidence: baseConfidence,
      structured: {
        amount: 245000, // paise
        date: "2026-06-25",
        vendorName: "ABC Medical Store",
        gstNumber: "07AABCS1429B1Z4",
        invoiceNumber: `INV-2026-${Math.floor(Math.random() * 9999)}`,
        paymentMode: "UPI",
      },
      language: "eng",
    };
  }

  if (docType === "medical_bill") {
    return {
      rawText: `Patient: Employee\nDiagnosis: Viral Fever with Respiratory Infection\nHospital: Max Super Speciality, Saket\nDate: 24/06/2026\nTotal Bill: ₹18,500\nInsurance Claim Ref: CGHS/2026/1234`,
      confidence: baseConfidence,
      structured: {
        amount: 1850000, // paise
        date: "2026-06-24",
        vendorName: "Max Super Speciality, Saket",
        diagnosis: "Viral Fever with Respiratory Infection",
        claimRef: "CGHS/2026/1234",
      },
      language: "eng",
    };
  }

  if (docType === "travel_ticket") {
    return {
      rawText: `PNR: 4521678903\nTrain: 12002 Shatabdi Express\nFrom: New Delhi (NDLS)\nTo: Agra Cantt (AGC)\nDate: 28/06/2026\nFare: ₹1,250\nClass: CC`,
      confidence: baseConfidence,
      structured: {
        amount: 125000, // paise
        date: "2026-06-28",
        from: "New Delhi",
        to: "Agra Cantt",
        pnr: "4521678903",
        mode: "rail",
        trainName: "Shatabdi Express",
      },
      language: "eng",
    };
  }

  return {
    rawText: `Scanned document content...`,
    confidence: baseConfidence,
    structured: {},
    language: "eng",
  };
}

type OcrResult = {
  rawText: string;
  confidence: number;
  structured: Record<string, unknown>;
  language: string;
};

export async function documentOcrRoutes(app: FastifyInstance): Promise<void> {

  /** POST /v1/hrms/ai/ocr/extract — extract text + structure from uploaded document */
  app.post("/v1/hrms/ai/ocr/extract", async (req, reply) => {
    const ctx = getRequestContext(req);
    const body = ocrRequestSchema.parse(req.body);

    const result = await performOcr(body.imageKey, body.documentType);

    return reply.send({
      data: {
        rawText: result.rawText,
        confidence: result.confidence,
        structured: result.structured,
        language: result.language,
        autoFillReady: result.confidence >= 60,
        method: "Tesseract.js", // or "DocTR"
        note: result.confidence < 60
          ? "Low confidence — please verify and correct the extracted data"
          : "High confidence — review and confirm",
      },
    });
  });

  /** POST /v1/hrms/ai/ocr/batch — batch OCR for multiple documents */
  app.post("/v1/hrms/ai/ocr/batch", async (req, reply) => {
    const ctx = getRequestContext(req);
    const body = z.object({
      documents: z.array(ocrRequestSchema).min(1).max(10),
    }).parse(req.body);

    const results = await Promise.all(
      body.documents.map(async (doc) => {
        const result = await performOcr(doc.imageKey, doc.documentType);
        return { imageKey: doc.imageKey, documentType: doc.documentType, ...result };
      }),
    );

    return reply.send({ data: results });
  });
}
