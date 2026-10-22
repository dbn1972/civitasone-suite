/**
 * The note an approver is about to approve, for the approvals queue (GAP-ESTAB-APPROVALS-03).
 * GET /v1/estab/files/:id returns the file with its note sheets. The note under approval is the
 * one its maker submitted (noteStatus "submitted"), so that is preferred: a draft started after
 * submitting, or a rejected note, can carry a later timestamp but is not what is being decided on.
 * Only when no note is submitted does the newest note by timestamp stand in for it.
 */
export type NoteSheetLike = { content?: unknown; author?: unknown; timestamp?: unknown; noteStatus?: unknown };

export type LatestNote = {
  content: string;
  /** The resolved author name; null when the service could not name the officer. */
  author: string | null;
  /** ISO timestamp the note was written; null when unknown. */
  at: string | null;
  /** True when this is the submitted note under approval, false when it is only the newest note. */
  underApproval: boolean;
};

function sortKey(value: unknown): number {
  if (typeof value !== "string") return Number.NEGATIVE_INFINITY;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : Number.NEGATIVE_INFINITY;
}

function hasText(sheet: NoteSheetLike | null | undefined): sheet is NoteSheetLike & { content: string } {
  return typeof sheet?.content === "string" && sheet.content.trim() !== "";
}

/** The newest of `sheets` by timestamp (the last listed when no timestamp parses). */
function newestOf<T extends NoteSheetLike>(sheets: T[]): T | undefined {
  let best: T | undefined;
  let bestKey = Number.NEGATIVE_INFINITY;
  for (const sheet of sheets) {
    const key = sortKey(sheet.timestamp);
    // ">=" so that among equal (or unparseable) timestamps the later-listed note wins.
    if (best === undefined || key >= bestKey) {
      best = sheet;
      bestKey = key;
    }
  }
  return best;
}

/**
 * The newest non-empty submitted note, else the newest non-empty note, by timestamp (the last
 * listed when no timestamp parses); undefined when no note has text.
 */
export function latestNoteOf(sheets: NoteSheetLike[] | null | undefined): LatestNote | undefined {
  if (!Array.isArray(sheets)) return undefined;
  const withText = sheets.filter(hasText);
  const submitted = withText.filter((sheet) => sheet.noteStatus === "submitted");
  const best = newestOf(submitted.length > 0 ? submitted : withText);
  if (best === undefined) return undefined;
  return {
    content: best.content,
    author: typeof best.author === "string" && best.author.trim() !== "" ? best.author : null,
    at: typeof best.timestamp === "string" && best.timestamp !== "" ? best.timestamp : null,
    underApproval: submitted.length > 0,
  };
}

/** Whitespace-collapsed note text cut to `max` characters with an ellipsis. */
export function noteExcerpt(content: string, max: number): string {
  const flat = content.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  return `${flat.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}
