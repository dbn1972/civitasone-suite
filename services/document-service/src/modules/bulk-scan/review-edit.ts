/** Pure reviewer-edit logic: field value normalisation, applying edits, audit-safe before/after views. */
import { createHash } from "node:crypto";
import { maskValue, isPiiFieldKind } from "./review-view.js";

export interface StoredField { kind: string; value: string; raw: string; confidence: number; pageNumber: number; bbox: unknown; manual?: boolean }
export interface FieldEdit { kind: string; value: string; pageNumber?: number | undefined }

/** Normalised value (date -> ISO, amount -> paise string, ids upper-cased) or null when the value is not valid for the kind. */
export function normalizeFieldValue(kind: string, value: string): string | null {
  const v = value.trim();
  switch (kind) {
    case "date": {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
      if (!m) return null;
      const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
      return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]) ? v : null;
    }
    case "amount_inr": {
      if (/^\d{1,18}$/.test(v)) return v;                                   // already paise
      const m = /^(\d{1,15})(?:\.(\d{1,2}))?$/.exec(v.replace(/,/g, ""));   // rupees
      return m ? String(BigInt(m[1] as string) * 100n + BigInt((m[2] ?? "").padEnd(2, "0") || "0")) : null;
    }
    case "pan": return /^[A-Za-z]{5}\d{4}[A-Za-z]$/.test(v) ? v.toUpperCase() : null;
    case "ifsc": return /^[A-Za-z]{4}0[A-Za-z0-9]{6}$/.test(v) ? v.toUpperCase() : null;
    case "aadhaar": return /^\d{4}\s?\d{4}\s?\d{4}$/.test(v) ? v.replace(/\s/g, "") : null;
    case "email": return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? v.toLowerCase() : null;
    case "phone": return /^\+?\d[\d\s-]{6,14}$/.test(v) ? v.replace(/[\s-]/g, "") : null;
    default: return v.length > 0 && v.length <= 100 ? v.toUpperCase() : null;
  }
}

/** Stored (and shown) form: PII kinds are kept masked only - a reviewer-typed Aadhaar/PAN is never persisted in clear. */
export function storedValue(kind: string, normalised: string): string {
  return isPiiFieldKind(kind) ? maskValue(kind, normalised) : normalised;
}

export function applyFieldEdits(existing: readonly StoredField[], edits: readonly FieldEdit[]): StoredField[] {
  const out = existing.map((f) => ({ ...f }));
  for (const e of edits) {
    const norm = normalizeFieldValue(e.kind, e.value);
    if (norm === null) throw new Error("INVALID_FIELD_VALUE:" + e.kind);
    const shown = storedValue(e.kind, norm);
    const i = out.findIndex((f) => f.kind === e.kind && (e.pageNumber === undefined || f.pageNumber === e.pageNumber));
    const base = i >= 0 ? out[i] : undefined;
    const next: StoredField = { kind: e.kind, value: shown, raw: shown, confidence: 1, pageNumber: e.pageNumber ?? base?.pageNumber ?? 1, bbox: base?.bbox ?? null, manual: true };
    if (i >= 0) out[i] = next; else out.push(next);
  }
  return out;
}

/** Audit-safe view of fields: kind + (already masked for PII kinds) value. */
export const auditFields = (fs: readonly StoredField[] | null | undefined): { kind: string; value: string }[] =>
  (fs ?? []).map((f) => ({ kind: f.kind, value: isPiiFieldKind(f.kind) ? maskValue(f.kind, f.value) : f.value }));

/** Text is never copied into audit events: only page, length and a content hash of the (masked) text. */
export const auditTextEdit = (pageNumber: number, text: string): { pageNumber: number; chars: number; sha256: string } =>
  ({ pageNumber, chars: text.length, sha256: createHash("sha256").update(text).digest("hex").slice(0, 16) });
