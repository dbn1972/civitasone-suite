/**
 * The latest note on a file, for the approvals queue: the approver reads what they are about to
 * approve (GAP-ESTAB-APPROVALS-03). GET /v1/estab/files/:id returns the file with its note
 * sheets; the newest one by timestamp is the note under approval.
 */
export type NoteSheetLike = { content?: unknown; author?: unknown; timestamp?: unknown };

export type LatestNote = {
  content: string;
  /** The resolved author name; null when the service could not name the officer. */
  author: string | null;
  /** ISO timestamp the note was written; null when unknown. */
  at: string | null;
};

function sortKey(value: unknown): number {
  if (typeof value !== "string") return Number.NEGATIVE_INFINITY;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : Number.NEGATIVE_INFINITY;
}

/** The newest non-empty note by timestamp (the last listed when no timestamp parses), or undefined. */
export function latestNoteOf(sheets: NoteSheetLike[] | null | undefined): LatestNote | undefined {
  if (!Array.isArray(sheets)) return undefined;
  let best: NoteSheetLike | undefined;
  let bestKey = Number.NEGATIVE_INFINITY;
  for (const sheet of sheets) {
    if (typeof sheet?.content !== "string" || sheet.content.trim() === "") continue;
    const key = sortKey(sheet.timestamp);
    // ">=" so that among equal (or unparseable) timestamps the later-listed note wins.
    if (best === undefined || key >= bestKey) {
      best = sheet;
      bestKey = key;
    }
  }
  if (best === undefined) return undefined;
  return {
    content: best.content as string,
    author: typeof best.author === "string" && best.author.trim() !== "" ? best.author : null,
    at: typeof best.timestamp === "string" && best.timestamp !== "" ? best.timestamp : null,
  };
}

/** Whitespace-collapsed note text cut to `max` characters with an ellipsis. */
export function noteExcerpt(content: string, max: number): string {
  const flat = content.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  return `${flat.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}
