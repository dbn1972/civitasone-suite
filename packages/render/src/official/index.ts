/**
 * @civitasone/render/official - issuable official documents (real A4 PDFs, embedded Noto Sans
 * Devanagari, Indian amounts and dates). See pdf-builder.ts for the layout engine.
 */
export { amountInWordsEn, amountInWordsHi, integerToIndianWords, integerToHindiWords } from "./amount-words.js";
export {
  toMinor, groupIndianDigits, formatIndianInteger, formatMinorIndian, formatInr, formatDateIst, formatDateTimeIst,
  formatMonthYear, maskPanForPrint, maskAccountForPrint, financialYearOf, IST_TIME_ZONE, type DocLang,
} from "./format.js";
export { DOC_FONT, DOC_FONT_STACK, docFontBytes, docFontFaceCss, docFontUnicodeRange, type DocFontSubset, type DocFontWeight } from "./fonts.js";
export { parseMarkdown, stripInlineMarkdown, type MdBlock } from "./markdown.js";
export {
  OfficialPdf, PdfRendererUnavailableError, esc as escapeHtml, type OfficialPdfOptions, type DocIssuer, type TableColumn, type TableSpec, type SignatureBlock, type FieldRow, type Align,
} from "./pdf-builder.js";
export {
  resolveDocIdentity, resolveSignatories, TenantIdentityUnavailableError, docIdentityFromTenant, resetDocIdentityCache, DocumentNotIssuableError,
  EMPTY_DOC_IDENTITY, DOC_IDENTITY_SETTING, type DocIdentity, type Signatory,
} from "./identity.js";
export { DocumentUnavailableError } from "./unavailable.js";
export { gstSplit, gstStateCode, placeOfSupplyLabel, GST_STATE_NAMES, type GstSplit } from "./gst.js";
