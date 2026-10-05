/** Typed input errors raised before any OCR happens (bad/unsupported/hostile uploads). */
export type OcrInputErrorCode = "ENCRYPTED_PDF" | "UNSUPPORTED_TYPE" | "TOO_MANY_PAGES" | "CORRUPT";

export class OcrInputError extends Error {
  constructor(public readonly code: OcrInputErrorCode, message: string) {
    super(message);
    this.name = "OcrInputError";
  }
}

export class OcrTimeoutError extends Error {
  constructor(public readonly providerId: string, public readonly timeoutMs: number) {
    super(`OCR provider "${providerId}" timed out after ${timeoutMs}ms`);
    this.name = "OcrTimeoutError";
  }
}

export class OcrChainError extends Error {
  constructor(message: string, public readonly causes: ReadonlyArray<{ providerId: string; error: unknown }>) {
    super(message);
    this.name = "OcrChainError";
  }
}
