/**
 * Review workspace logic that does not need React: keyboard shortcut resolution, draft/edit-payload building with
 * optimistic versions, queue neighbours, word navigation, defensive PII preview masking and link/amount matching.
 */
import { parseRupeesToPaise } from "@/lib/money";
import type { LinkSuggestion, ReviewDetail, ReviewQueueItem } from "./types";

// ── keyboard shortcuts ──────────────────────────────────────────

export type ShortcutAction =
  | "zoomIn" | "zoomOut" | "rotate" | "rotateBack" | "fit" | "prevPage" | "nextPage" | "nextFile" | "prevFile" | "approve" | "edit" | "help" | "pickFirst" | "pickSecond";

export interface KeyEventLike {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  target?: { tagName?: string; isContentEditable?: boolean; role?: string | null } | null;
}

/** ARIA roles whose widgets take typed characters / arrow keys themselves, so a single-key shortcut must not fire on them. */
const TEXT_ENTRY_ROLES = new Set(["textbox", "searchbox", "combobox", "listbox", "spinbutton", "slider"]);

export function isEditableTarget(t: KeyEventLike["target"]): boolean {
  if (!t) return false;
  const tag = (t.tagName ?? "").toUpperCase();
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || t.isContentEditable === true || TEXT_ENTRY_ROLES.has((t.role ?? "").toLowerCase());
}

/**
 * WCAG 2.1.4 (Character Key Shortcuts): the single-key shortcuts below are only active while keyboard focus is inside the review
 * workspace region AND the reviewer has them switched on. The switch is remembered per user (per browser when the session exposes
 * no user id). Storage can be blocked or throw, so every access is guarded and the default is "on".
 */
export const SHORTCUTS_PREF_PREFIX = "bulkScan.reviewShortcuts";
export const shortcutsPrefKey = (userId: string | null): string => `${SHORTCUTS_PREF_PREFIX}.${userId && userId.trim() ? userId.trim() : "browser"}`;

export function readShortcutsPref(storage: Pick<Storage, "getItem"> | null, key: string): boolean {
  try {
    return storage?.getItem(key) !== "off";
  } catch {
    return true;
  }
}

export function writeShortcutsPref(storage: Pick<Storage, "setItem"> | null, key: string, on: boolean): void {
  try {
    storage?.setItem(key, on ? "on" : "off");
  } catch { /* storage unavailable: the choice then only lasts for this page view */ }
}

/** The shortcut for a key press, or null. Never fires while typing in a field or with Ctrl/Meta/Alt held (browser/OS shortcuts). */
export function resolveShortcut(e: KeyEventLike): ShortcutAction | null {
  if (isEditableTarget(e.target) || e.ctrlKey || e.metaKey || e.altKey) return null;
  switch (e.key) {
    case "+": case "=": return "zoomIn";
    case "-": case "_": return "zoomOut";
    case "r": return "rotate";
    case "R": return "rotateBack";
    case "0": case "f": return "fit";
    case "[": return "prevPage";
    case "]": return "nextPage";
    case "n": return "nextFile";
    case "p": return "prevFile";
    case "a": return "approve";
    case "e": return "edit";
    case "?": return "help";
    case "1": return "pickFirst";
    case "2": return "pickSecond";
    default: return null;
  }
}

/** Documentation table for the help dialog (keys are literal, labels are i18n keys under bulkScan.review.shortcut). */
export const SHORTCUT_HELP: ReadonlyArray<{ keys: string; labelKey: string }> = [
  { keys: "+  /  -", labelKey: "zoom" },
  { keys: "0  /  f", labelKey: "fit" },
  { keys: "r  /  Shift+R", labelKey: "rotate" },
  { keys: "←  ↑  →  ↓", labelKey: "pan" },
  { keys: "[  /  ]", labelKey: "page" },
  { keys: "n  /  p", labelKey: "file" },
  { keys: "a", labelKey: "approve" },
  { keys: "e", labelKey: "edit" },
  { keys: "1  /  2", labelKey: "pick" },
  { keys: "?", labelKey: "help" },
];

// ── navigation helpers ──────────────────────────────────────────

export function clampIndex(i: number, count: number): number {
  return count <= 0 ? 0 : Math.min(count - 1, Math.max(0, i));
}

/** Next/previous word index for roving focus (ArrowLeft/Right, Home, End). Returns null for other keys. */
export function nextWordIndex(current: number, count: number, key: string): number | null {
  if (count <= 0) return null;
  switch (key) {
    case "ArrowRight": case "ArrowDown": return clampIndex(current + 1, count);
    case "ArrowLeft": case "ArrowUp": return clampIndex(current - 1, count);
    case "Home": return 0;
    case "End": return count - 1;
    default: return null;
  }
}

/** The queue item after/before `fileId`, or null at either end (or when the file is not in the queue). */
export function queueNeighbour(queue: readonly ReviewQueueItem[], fileId: string, dir: 1 | -1): ReviewQueueItem | null {
  const i = queue.findIndex((q) => q.fileId === fileId);
  if (i < 0) return null;
  return queue[i + dir] ?? null;
}

export const reviewPath = (batchId: string, fileId: string): string => `/admin/bulk-scan/review/${encodeURIComponent(batchId)}/${encodeURIComponent(fileId)}`;

// ── drafts and the edit payload ─────────────────────────────────

export interface FieldDraft { kind: string; value: string; pageNumber: number | null }
export interface ReviewDraft {
  docType: string | null;
  fields: FieldDraft[];
  tags: string[];
  /** only pages the reviewer edited are present */
  text: Record<number, string>;
}

export function draftFromDetail(d: ReviewDetail): ReviewDraft {
  return {
    docType: d.file.docType ?? d.classification.docType,
    fields: d.fields.map((f) => ({ kind: f.kind, value: f.value, pageNumber: f.pageNumber })),
    tags: [...d.file.tags],
    text: {},
  };
}

export interface EditPayload {
  expectedVersion: number;
  docType?: string;
  fields?: Array<{ kind: string; value: string; pageNumber?: number }>;
  tags?: string[];
  text?: Array<{ pageNumber: number; text: string }>;
}

export function parseTags(input: string): string[] {
  const seen = new Set<string>();
  for (const t of input.split(/[,\n]/)) {
    const v = t.trim().slice(0, 64);
    if (v) seen.add(v);
  }
  return [...seen].slice(0, 20);
}

/** Only what changed, tagged with the version the reviewer loaded. null = nothing to save. */
export function buildEditPayload(original: ReviewDetail, draft: ReviewDraft): EditPayload | null {
  const base = draftFromDetail(original);
  const payload: EditPayload = { expectedVersion: original.file.version };
  let changed = false;
  if (draft.docType && draft.docType !== base.docType) { payload.docType = draft.docType; changed = true; }
  if (JSON.stringify(draft.fields) !== JSON.stringify(base.fields)) {
    payload.fields = draft.fields.map((f) => ({ kind: f.kind, value: f.value, ...(f.pageNumber !== null ? { pageNumber: f.pageNumber } : {}) }));
    changed = true;
  }
  if (JSON.stringify(draft.tags) !== JSON.stringify(base.tags)) { payload.tags = draft.tags; changed = true; }
  const originalText = new Map(original.pages.map((p) => [p.pageNumber, p.text]));
  const edited = Object.entries(draft.text)
    .map(([n, text]) => ({ pageNumber: Number(n), text }))
    .filter((p) => originalText.has(p.pageNumber) && originalText.get(p.pageNumber) !== p.text);
  if (edited.length > 0) { payload.text = edited; changed = true; }
  return changed ? payload : null;
}

export const isDirty = (original: ReviewDetail, draft: ReviewDraft): boolean => buildEditPayload(original, draft) !== null;

// ── PII defence in depth ────────────────────────────────────────

/**
 * The API only sends masked previews. As a second line of defence, any run of 9+ digits that slipped through is masked
 * down to its last four before it can reach the DOM.
 */
export function safeMaskedPreview(preview: string): string {
  return preview.replace(/\d{9,}/g, (run) => `${"X".repeat(run.length - 4)}${run.slice(-4)}`);
}

// ── link target / amount matching ───────────────────────────────

export const FINANCE_TARGETS: readonly string[] = ["finance_payment", "finance_voucher", "finance_bill"];
export const isFinanceTarget = (t: string): boolean => FINANCE_TARGETS.includes(t);

/**
 * The document's extracted INR amount in paise. The OCR extractor stores amount_inr values as a paise digit string
 * ("125000" = Rs 1,250.00); a reviewer-typed value with a decimal point or rupee marks is read as rupees.
 */
export function documentAmountMinor(fields: ReadonlyArray<{ kind: string; value: string }>): string | null {
  for (const f of fields) {
    if (f.kind !== "amount_inr") continue;
    const v = f.value.trim();
    if (/^\d{1,18}$/.test(v)) return v;
    const minor = parseRupeesToPaise(v.replace(/₹|rs\.?|inr|\s/gi, ""));
    if (minor !== null) return minor;
  }
  return null;
}

/**
 * Finance candidates whose amount differs from the document are NEVER attachable. The server flags it (`mismatch`), and we
 * also compare locally so a missing flag can not let a mismatch through. Non-finance targets have no amount rule.
 */
export function isAmountMismatch(candidate: Pick<LinkSuggestion, "target" | "amountMinor" | "mismatch">, docAmountMinor: string | null): boolean {
  if (!isFinanceTarget(candidate.target)) return false;
  if (candidate.mismatch) return true;
  if (docAmountMinor === null || candidate.amountMinor === null) return false;
  try {
    return BigInt(candidate.amountMinor) !== BigInt(docAmountMinor);
  } catch {
    return true;
  }
}
