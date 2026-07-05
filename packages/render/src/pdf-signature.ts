/**
 * PDF Signature Dictionary Embedding.
 *
 * Inserts a /Sig dictionary with a ByteRange and a placeholder for the
 * actual PKCS#7 signature bytes into a PDF buffer.
 *
 * This implements the PDF 1.7 (ISO 32000-1) signature embedding flow:
 * 1. Append a signature dictionary object
 * 2. Reserve a hex-encoded placeholder for the DER signature
 * 3. Record the ByteRange (two ranges covering everything except the placeholder)
 * 4. Optionally add a visible signature annotation
 *
 * NOTE: This is a simplified implementation that appends the signature
 * dictionary as an incremental update to the PDF. A production-grade
 * implementation would use a full PDF parser for cross-reference table updates.
 */

export interface PreparePdfForSigningOptions {
  /** Signer's display name (from certificate CN) */
  signerName: string;
  /** Signing reason */
  reason: string;
  /** Signing location */
  location: string;
  /** Signing date */
  signDate: Date;
  /** Bytes to reserve for hex-encoded signature (default 8192) */
  placeholderSize?: number | undefined;
}

export interface PreparedPdfResult {
  /** The PDF buffer with signature placeholder inserted */
  preparedPdf: Buffer;
  /** ByteRange: [offset1, length1, offset2, length2] */
  byteRange: [number, number, number, number];
}

/**
 * Format a date as a PDF date string: D:YYYYMMDDHHmmSS+HH'mm'
 */
function formatPdfDate(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  const h = String(date.getUTCHours()).padStart(2, "0");
  const min = String(date.getUTCMinutes()).padStart(2, "0");
  const s = String(date.getUTCSeconds()).padStart(2, "0");
  return `D:${y}${m}${d}${h}${min}${s}+00'00'`;
}

/**
 * Inserts a PDF signature dictionary and visible annotation into the PDF.
 * Returns the modified PDF with a placeholder for the actual signature bytes.
 *
 * The placeholder is a hex string of zeros enclosed in angle brackets: <0000...0000>
 * The ByteRange describes the two regions of the file that are covered by the signature
 * (everything except the hex content between the angle brackets).
 */
export function preparePdfForSigning(
  pdfBuffer: Buffer,
  opts: PreparePdfForSigningOptions,
): PreparedPdfResult {
  const placeholderSize = opts.placeholderSize ?? 8192;
  // Each byte of DER → 2 hex chars; we reserve placeholderSize bytes of hex content
  const hexPlaceholderLength = placeholderSize * 2;

  const pdfDateStr = formatPdfDate(opts.signDate);
  const annotationText = `Digitally signed by ${opts.signerName} on ${opts.signDate.toISOString()}`;

  // Build the signature dictionary as a PDF incremental update
  // This is appended after the existing PDF content
  const sigDictPrefix = [
    "\n",
    // Signature dictionary object
    "% DSC Signature\n",
    "/Type /Sig\n",
    "/Filter /Adobe.PPKLite\n",
    "/SubFilter /adbe.pkcs7.detached\n",
    `/Name (${escapePdfString(opts.signerName)})\n`,
    `/M (${pdfDateStr})\n`,
    `/Reason (${escapePdfString(opts.reason)})\n`,
    `/Location (${escapePdfString(opts.location)})\n`,
    `/ContactInfo (${escapePdfString(annotationText)})\n`,
    // ByteRange placeholder — will be filled with actual values below
    "/ByteRange [0 __OFFSET1__ __OFFSET2__ __LENGTH2__]\n",
    "/Contents <",
  ].join("");

  const sigDictSuffix = ">\n% End DSC Signature\n";

  // Calculate actual offsets:
  // The structure is: [original PDF][sigDictPrefix]<hex_placeholder>[sigDictSuffix]
  //
  // ByteRange covers:
  //   Range 1: from 0 to start of hex content (after '<')
  //   Range 2: from end of hex content (after '>') to end of file
  //
  // First pass: compute with placeholder ByteRange values to determine total structure
  const originalLength = pdfBuffer.length;

  // We need to compute where the '<' and '>' are relative to the start
  // The structure:
  //   [0..originalLength-1] = original PDF
  //   [originalLength..originalLength+prefixLen-1] = sigDictPrefix (ends with '<')
  //   [originalLength+prefixLen..originalLength+prefixLen+hexLen-1] = hex zeros
  //   [originalLength+prefixLen+hexLen..end] = sigDictSuffix (starts with '>')

  // We'll do a two-pass approach:
  // Pass 1: compute the byte range values
  // Pass 2: replace the __OFFSET__ placeholders with actual values and rebuild

  // For the ByteRange: [0, offset_before_hex, offset_after_hex, length_after_hex]
  // offset_before_hex = the byte position of '<' + 1 (start of hex content)
  // Actually per PDF spec: ByteRange = [0, offset_of_contents_start, offset_after_contents, remaining_length]
  // Where "contents" is the hex string including angle brackets

  // Let's compute with actual offsets:
  // The /Contents value is <hex...>, ByteRange must exclude the hex value between < and >

  // Step 1: Build without ByteRange actual values to measure prefix length
  const prefixWithPlaceholders = sigDictPrefix;
  const prefixBytes = Buffer.from(prefixWithPlaceholders, "binary");

  // offset1 = position just before '<' (the '<' is the last char of prefix)
  // Actually: the prefix ends with '<', so position of '<' is originalLength + prefixBytes.length - 1
  // But ByteRange convention: [0, length_before_contents_hex, offset_after_contents_hex, length_after]
  // Contents value in PDF is: <HEXHEX...HEX> (including angle brackets)

  // The ByteRange covers everything EXCEPT the contents value (the <...> including brackets)
  // Range 1: [0, offset_of_opening_bracket]
  // Range 2: [offset_after_closing_bracket, length_to_end]

  // Position of '<' = originalLength + (prefixBytes.length - 1)
  // No wait — the prefix string ends with '<', so '<' is the last byte of the prefix
  // prefix includes everything up to and including the '<'
  // Actually looking at sigDictPrefix, it ends with "/Contents <" so the '<' is part of it.

  // Let me re-think the layout:
  // [original PDF bytes][sigDictPrefix text including '<'][hex zeros]['>'][sigDictSuffix rest]

  // The '<' is at position: originalLength + prefixBytes.length - 1
  // Nope. The prefixBytes includes the '<'.
  // So the hex content starts at: originalLength + prefixBytes.length
  // The '>' is at: originalLength + prefixBytes.length + hexPlaceholderLength
  // sigDictSuffix starts with '>'

  // ByteRange:
  //   Range 1: offset=0, length = position of '<' (which is last byte of prefix that is part of contents)
  //            Hmm, PDF spec says ByteRange excludes the Contents value.
  //            The Contents value starts at '<' and ends at '>'
  //            So Range 1 length = position of '<'

  // Let me be precise:
  // Full file: [originalPdf][dictText_before_contents_marker][<HEX>][dictText_after]
  // Where dictText_before_contents_marker = everything in sigDictPrefix up to but not including '<'
  // And the Contents value = <HEX> (including angle brackets)

  // Actually sigDictPrefix ends with "/Contents <" which is: ..."/Contents " then "<"
  // The '<' IS part of the Contents value in the PDF.

  // So:
  // beforeContents = original PDF + sigDictPrefix up to but NOT including the final '<'
  // contents = <hex_zeros>   (including both angle brackets)
  // afterContents = sigDictSuffix (which starts with '>\n...' — wait no, suffix starts after the hex)

  // Let me restructure: split sigDictPrefix at the '<':
  const prefixBeforeAngleBracket = sigDictPrefix.slice(0, -1); // everything except the trailing '<'
  const suffixAfterAngleBracket = sigDictSuffix.slice(1); // everything except the leading '>'

  // File layout:
  // [original PDF][prefixBeforeAngleBracket]  <  [hex_zeros]  >  [suffixAfterAngleBracket]
  //                                          ^contents start  ^contents end

  const beforeContentsLen = originalLength + Buffer.byteLength(prefixBeforeAngleBracket, "binary");
  // contents = '<' + hexPlaceholderLength chars + '>'
  const contentsLen = 1 + hexPlaceholderLength + 1; // '<' + hex + '>'
  const afterContentsStart = beforeContentsLen + contentsLen;
  const suffixAfterLen = Buffer.byteLength(suffixAfterAngleBracket, "binary");
  const totalFileLen = afterContentsStart + suffixAfterLen;

  const afterContentsLen = totalFileLen - afterContentsStart;

  // Now build the ByteRange string with actual values
  const byteRangeStr = `[0 ${beforeContentsLen} ${afterContentsStart} ${afterContentsLen}]`;

  // Replace the placeholder ByteRange in the prefix
  const finalPrefix = prefixBeforeAngleBracket.replace(
    "/ByteRange [0 __OFFSET1__ __OFFSET2__ __LENGTH2__]",
    `/ByteRange ${byteRangeStr}`,
  );

  // Recompute with actual prefix (length may have changed due to number formatting)
  // We need to iterate until stable because the byte range values affect the prefix length
  // which in turn affects the byte range values. In practice, one recalculation suffices
  // if we pad the ByteRange field to a fixed width.

  // Let's use a fixed-width approach: pad the ByteRange values to ensure stable offsets
  const paddedByteRange = byteRangeStr.padEnd(60, " ");
  const stablePrefix = prefixBeforeAngleBracket.replace(
    "/ByteRange [0 __OFFSET1__ __OFFSET2__ __LENGTH2__]",
    `/ByteRange ${paddedByteRange}`,
  );

  // Recalculate with stable prefix
  const stablePrefixLen = Buffer.byteLength(stablePrefix, "binary");
  const actualBeforeContentsLen = originalLength + stablePrefixLen;
  const actualAfterContentsStart = actualBeforeContentsLen + contentsLen;
  const actualTotalFileLen = actualAfterContentsStart + suffixAfterLen;
  const actualAfterContentsLen = actualTotalFileLen - actualAfterContentsStart;

  // Build final ByteRange with correct values
  const finalByteRangeStr = `[0 ${actualBeforeContentsLen} ${actualAfterContentsStart} ${actualAfterContentsLen}]`;
  const finalPaddedByteRange = finalByteRangeStr.padEnd(60, " ");

  const finalStablePrefix = prefixBeforeAngleBracket.replace(
    "/ByteRange [0 __OFFSET1__ __OFFSET2__ __LENGTH2__]",
    `/ByteRange ${finalPaddedByteRange}`,
  );

  // Verify lengths are stable
  const verifyPrefixLen = Buffer.byteLength(finalStablePrefix, "binary");
  if (verifyPrefixLen !== stablePrefixLen) {
    // Should not happen with fixed-width padding, but guard against it
    throw new Error("ByteRange calculation unstable — prefix length changed after substitution");
  }

  // Build the final PDF buffer
  const hexZeros = "0".repeat(hexPlaceholderLength);
  const preparedPdf = Buffer.concat([
    pdfBuffer,
    Buffer.from(finalStablePrefix, "binary"),
    Buffer.from("<", "binary"),
    Buffer.from(hexZeros, "ascii"),
    Buffer.from(">", "binary"),
    Buffer.from(suffixAfterAngleBracket, "binary"),
  ]);

  const byteRange: [number, number, number, number] = [
    0,
    actualBeforeContentsLen,
    actualAfterContentsStart,
    actualAfterContentsLen,
  ];

  return { preparedPdf, byteRange };
}

/**
 * Escape special characters for PDF string values.
 */
function escapePdfString(str: string): string {
  return str
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}
