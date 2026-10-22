/**
 * GAP-HR-EMPLOYEES-IMPORT-03: a small RFC 4180 reader for the bulk employee
 * import.
 *
 * The earlier readers split the file on "\n" FIRST and only then looked at
 * quotes, so a quoted value that legitimately contained a line break (a
 * multi-line address pasted from a spreadsheet, say) was cut in half and every
 * later column shifted. This reads the whole text as one stream instead:
 *
 *  - quoted fields may contain commas, line breaks and "" (an escaped quote);
 *  - CRLF, LF and bare CR all end a record;
 *  - a leading UTF-8 byte-order mark (what Excel's "CSV UTF-8" adds) is dropped;
 *  - fully blank lines are skipped;
 *  - every cell is trimmed, matching what the import has always done;
 *  - each record carries the physical line it STARTS on, so an error message
 *    can name the row a person sees in their spreadsheet even when an earlier
 *    record spanned several lines;
 *  - a quote that is opened and never closed is reported (`unterminatedQuoteLine`)
 *    instead of silently swallowing every remaining row into one giant cell.
 */
export type CsvRecord = { lineNo: number; cells: string[] };
export type CsvParseResult = {
  records: CsvRecord[];
  /** 1-based line where a never-closed quote began, or null when the file is well formed. */
  unterminatedQuoteLine: number | null;
};

export function parseCsv(input: string): CsvParseResult {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const records: CsvRecord[] = [];
  let cells: string[] = [];
  let cur = "";
  let inQuotes = false;
  let quoteOpenedOnLine = 0;
  let line = 1;
  let recordStartLine = 1;
  // True once the current record has any content (a cell separator or a
  // character, quoted or not), so a quoted empty value ("") still counts as a
  // record while a truly blank line does not.
  let recordHasContent = false;

  const endCell = () => {
    cells.push(cur.trim());
    cur = "";
  };
  const endRecord = () => {
    if (recordHasContent) {
      endCell();
      records.push({ lineNo: recordStartLine, cells });
    }
    cells = [];
    cur = "";
    recordHasContent = false;
  };

  for (let i = 0; i < text.length; i++) {
    const c = text[i] as string;
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        if (c === "\n") line++;
        cur += c;
      }
      continue;
    }
    if (c === '"') {
      if (!recordHasContent) recordStartLine = line;
      inQuotes = true;
      quoteOpenedOnLine = line;
      recordHasContent = true;
    } else if (c === ",") {
      if (!recordHasContent) recordStartLine = line;
      recordHasContent = true;
      endCell();
    } else if (c === "\r" || c === "\n") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      endRecord();
      line++;
    } else {
      if (!recordHasContent && c.trim() !== "") {
        recordStartLine = line;
        recordHasContent = true;
      } else if (!recordHasContent) {
        // Leading whitespace on an otherwise blank line: keep scanning, the
        // line only counts once something other than whitespace appears.
        continue;
      }
      cur += c;
    }
  }
  const unterminatedQuoteLine = inQuotes ? quoteOpenedOnLine : null;
  endRecord();
  return { records, unterminatedQuoteLine };
}
