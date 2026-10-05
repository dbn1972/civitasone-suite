/**
 * Single seam to @civitasone/ocr's final contracts (packages/ocr/src/types.ts). Everything in the
 * bulk-scan module imports OCR vocabulary from here so the dependency on the package is one line.
 */
export { OCR_LANGS, OCR_PROVIDER_IDS, DEFAULT_PII_POLICY, DEFAULT_CLASSIFIER_CONFIG, detectPii, maskText } from "@civitasone/ocr";
export type {
  OcrLang, OcrProviderId, FieldKind, PiiType, PiiAction, PiiPolicy,
  ExtractedField, Classification, PiiFinding,
} from "@civitasone/ocr";
