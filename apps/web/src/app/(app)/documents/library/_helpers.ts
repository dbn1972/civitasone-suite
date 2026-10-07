/**
 * GAP-DOCUMENTS-LIBRARY-06: a short human label for a MIME type ("Word" instead
 * of "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
 * so a long vnd.* string doesn't blow out the column. The full MIME stays in the
 * cell's `title` for anyone who needs it.
 */
export function mimeLabel(mime: string | null): string {
  if (!mime) return "—";
  if (mime.includes("pdf")) return "PDF";
  if (mime.includes("spreadsheet") || mime.includes("excel")) return "Excel";
  if (mime === "text/csv" || mime.endsWith("/csv")) return "CSV";
  if (mime.includes("wordprocessing") || mime.includes("msword")) return "Word";
  if (mime.includes("presentation") || mime.includes("powerpoint")) return "PowerPoint";
  if (mime.startsWith("image/")) return "Image";
  if (mime.includes("zip") || mime.includes("compressed")) return "ZIP";
  if (mime === "text/plain") return "Text";
  const slash = mime.lastIndexOf("/");
  return slash >= 0 ? mime.slice(slash + 1).toUpperCase() : mime;
}

/** GAP-DOCUMENTS-LIBRARY-06: renamed from the misleading `priorityPill` (file status, not priority). */
export function fileStatusTone(status: string) {
  if (status === "active") return "good";
  if (status === "deleted") return "bad";
  return "mut";
}
