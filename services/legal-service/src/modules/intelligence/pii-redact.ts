/**
 * PII Redaction — strips personally identifiable information before sending to LLM.
 *
 * Patterns redacted:
 *   - Aadhaar: 12 digits (optionally space-separated 4-4-4) → [AADHAAR]
 *   - PAN: 5 uppercase letters + 4 digits + 1 uppercase letter → [PAN]
 *   - Phone numbers: 10 consecutive digits → [PHONE]
 *   - Email: standard email pattern → [EMAIL]
 *   - Names: replaced from explicit context/metadata list → [NAME]
 *
 * Only entity IDs and redacted text are passed to the LLM.
 */

// ── Patterns ──────────────────────────────────────────────────────

/** Aadhaar: 4 digits + optional space + 4 digits + optional space + 4 digits */
const AADHAAR_PATTERN = /\b\d{4}\s?\d{4}\s?\d{4}\b/g;

/** PAN: 5 uppercase letters + 4 digits + 1 uppercase letter */
const PAN_PATTERN = /\b[A-Z]{5}\d{4}[A-Z]\b/g;

/** Phone: exactly 10 consecutive digits (not part of a longer number) */
const PHONE_PATTERN = /\b\d{10}\b/g;

/** Email: standard email regex */
const EMAIL_PATTERN = /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g;

// ── Public API ────────────────────────────────────────────────────

export interface RedactionOptions {
  /** Names to redact from the text (from document metadata / context) */
  names?: string[];
}

export interface RedactionResult {
  /** Text with all PII replaced by placeholder tokens */
  redactedText: string;
  /** Count of PII items redacted by type */
  redactions: {
    phones: number;
    aadhaar: number;
    pan: number;
    emails: number;
    names: number;
  };
}

/**
 * Strip all PII from the given text and replace with placeholder tokens.
 *
 * Order matters: Aadhaar (12 digits with spaces) is checked before phone (10 digits)
 * to avoid partial matches.
 */
export function redactPii(text: string, options?: RedactionOptions): RedactionResult {
  let result = text;
  const redactions = { phones: 0, aadhaar: 0, pan: 0, emails: 0, names: 0 };

  // 1. Aadhaar (before phone to avoid substring matches)
  result = result.replace(AADHAAR_PATTERN, () => {
    redactions.aadhaar++;
    return "[AADHAAR]";
  });

  // 2. PAN
  result = result.replace(PAN_PATTERN, () => {
    redactions.pan++;
    return "[PAN]";
  });

  // 3. Phone (10 digits — must come after Aadhaar replacement)
  result = result.replace(PHONE_PATTERN, () => {
    redactions.phones++;
    return "[PHONE]";
  });

  // 4. Email
  result = result.replace(EMAIL_PATTERN, () => {
    redactions.emails++;
    return "[EMAIL]";
  });

  // 5. Names (from context/metadata)
  if (options?.names && options.names.length > 0) {
    for (const name of options.names) {
      if (!name || name.length < 2) continue;
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const namePattern = new RegExp(`\\b${escaped}\\b`, "gi");
      result = result.replace(namePattern, () => {
        redactions.names++;
        return "[NAME]";
      });
    }
  }

  return { redactedText: result, redactions };
}
