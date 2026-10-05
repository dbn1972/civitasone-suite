# @civitasone/ocr

Provider-agnostic OCR (tesseract.js locally, cloud adapters), PDF/image preprocessing, document post-processing
(field extraction, classification, PII detection/masking) and outputs (plain text, structured JSON, searchable PDF).

## Tests

- `pnpm --filter @civitasone/ocr test` - fast unit tests (default; excludes `tests/cer`).
- `pnpm --filter @civitasone/ocr test:cer` - real-OCR accuracy (CER per language) and end-to-end tests.
  Needs tesseract traineddata (`OCR_TESSDATA_PATH`, or `OCR_TEST_DOWNLOAD=1` to fetch into `<tmpdir>/bulk-scan-01-tessdata`)
  and fixture fonts (`OCR_FIXTURE_FONT_DOWNLOAD=1`, or a populated `OCR_FIXTURE_FONT_DIR`). Languages whose data/font is
  missing are reported as `skipped`, never faked. Output lines: `CER <lang> <value> n=<samples>`.
- `pnpm --filter @civitasone/ocr exec tsx tests/cer/perf-50pages.bench.ts` - 50-page throughput / peak RSS.

## Searchable-PDF fonts (setup step)

The invisible text layer of `buildSearchablePdf` is Latin-only by default (built-in Helvetica). To embed other scripts
you need one Unicode font per script plus `@pdf-lib/fontkit` (a dependency of this package). Fonts are never committed:

```sh
node packages/ocr/scripts/fetch-fonts.mjs /opt/civitasone/ocr-fonts   # Noto Sans, SIL OFL
export OCR_PDF_FONT_DIR=/opt/civitasone/ocr-fonts
```

Fetched: Latin, Devanagari (hin, mar), Bengali (ben, asm), Tamil, Telugu, Gujarati, Kannada, Malayalam, Gurmukhi (pan),
Odia (ori), Arabic (Noto Naskh; urd). The script is matched by file-name (`NotoSans<Script>-Regular.ttf`); you can also pass
`fontPaths: { Devanagari: "/path.ttf" }`. Set `OCR_FONT_MIRROR` to fetch from an internal mirror (air-gapped hosts).

If a script has no font, `buildSearchablePdf` still succeeds: words in that script are left out of the text layer and the
page is listed in the result's `degradedPages` (with `droppedScripts`) so the UI can show it. The layer is written in
logical Unicode order (no visual shaping), so copy/search returns exactly the OCR text.
Urdu uses Naskh, not Nastaliq: the invisible layer only needs the code points, not the calligraphic look.

## Memory, limits and safety defaults

- **One page at a time.** `processDocumentStream()` (async generator) and `processDocument()` rasterise, preprocess and OCR a single page before touching the next, so peak memory is one page's working set, not pages x size. `processDocument` still returns every preprocessed page image by default (`retainImages: true`; the searchable PDF and review viewer need them, cost ~ pageCount x PNG size). Pass `retainImages: false` and/or `onPage` to persist pages as they complete and keep memory flat; `pages` is then `[]`. Each chain call carries one page, and up to `pageConcurrency` pages (default 2 = tesseract `maxWorkers`) run at once so the worker pool stays busy; never more than that many rasterised pages are alive, results are delivered in page order.
- **Caps.** `maxPages` (default 200) is checked from the PDF page tree / TIFF directory BEFORE any page is rasterised (`OcrInputError TOO_MANY_PAGES`). `maxPixels` (default 25 MP, about 100 MB RGBA canvas; A3 at 300 DPI is ~17 MP) downsizes larger pages and records `render_downscaled`, `render_requested_dpi`, `render_dpi` in the page `metadata`. `maxImageSize` (pdfjs, default 40 MP) bounds a single embedded image; pdfjs skips larger images, so raise it only if you accept the memory.
- **Abort.** `signal` is checked before every page (throws the signal's AbortError). A caller abort inside the provider chain does NOT count toward the circuit-breaker threshold; timeouts do.
- **Encrypted PDFs.** Decided by pdfjs (`PasswordException`), not by a byte scan. PDFs that need a password are rejected `ENCRYPTED_PDF`; owner-password-only PDFs (open without a password) are accepted.
- **Cloud providers.** `mode: "sandbox"` (fake text) is honoured only when `NODE_ENV` is `development` or `test`, or `allowSandbox: true` is passed in code (tests). Anything else behaves as production (unavailable / `OcrNotImplementedError`).

## PII behaviour worth knowing

- Aadhaar-SHAPED numbers (12 digits, first digit 2-9; contiguous or 4-4-4 split by up to two spaces/hyphens or a line break) are reported even when Verhoeff fails (low `validation`, same policy action as Aadhaar). 16-digit VIDs (and 16-digit card-shaped numbers) are reported as `aadhaar` with a `XXXX XXXX XXXX 1234` preview. `strictAadhaar: true` restores checksum-only. Trade-off: 12-digit ids/timestamps starting 2-9 are masked too (under-masking is the worse error for DPDP).
- The classifier AI hook receives text with every PII type replaced by `[REDACTED]` regardless of tenant policy.
- `scrubString`/`scrubForLog` keep at most the last 4 digits of any digit group and scrub numeric values of 9+ digits; `@civitasone/scan-link` `scrubReasonText` is kept identical (parity test in `packages/scan-link/tests/scrub-parity.test.ts`).
- Labelled identifiers (`Voucher No`, `Bill No`, `File No`, `Emp ID`, `UTR`, `Invoice No`) keep their TRUE value in `extractFields` even when the digits look like an Aadhaar that fails the checksum (finance matching needs them); `detectPii`/`maskText`/AI redaction still mask the same digits. Year runs (`2024 2025 2026`) and `yyyymmddhhmm` timestamps are not treated as Aadhaar unless they pass Verhoeff. A 16-digit number after an `A/c`/`Account`/`Acct`/`खाता` label is a `bank_account` (type stays `bank_account`; 16-digit labelled accounts are always masked - a `flag` action is upgraded to `mask`, `redact` is kept; shorter accounts follow the plain bank_account policy), not a VID.
