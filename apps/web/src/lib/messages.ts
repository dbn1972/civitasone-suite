/**
 * One plain-language vocabulary for everything that can go wrong, so a clerk
 * never sees raw server text, HTTP status codes, stack traces, or developer
 * phrasing. Every message says what happened and what to do next, and offers at
 * least one safe action. Requirements 5 and 6.
 */

export type SafeAction = "retry" | "back" | "help" | "signin";

import {
  DOMAIN_CODE_MESSAGES,
  resolveHumanError,
  type ErrorContext,
  type ErrorStatusKind,
} from "./errorCatalogue";
import { classifyThrown, UserFacingError } from "./userFacingError";
import { resolveServiceCode } from "./serviceErrorCodes";

export type HumanError = {
  /** What happened, in plain words. (R6.1) */
  what: string;
  /** What the clerk can do next, in plain words. (R6.2) */
  next: string;
  /** Safe actions to offer — at least one. (R6.3) */
  actions: SafeAction[];
};

export type MessageKind =
  | "load"
  | "save"
  | "offline"
  | "unknownStatus"
  | "accepted"
  | "forbidden"
  | "conflict"
  | "invalid";

/**
 * Build a clerk-safe message for a known situation. `area` is an optional plain
 * noun (e.g. "bill", "leave request") to make the copy specific; it must already
 * be plain language (no internal names).
 */
export function toHumanError(kind: MessageKind, ctx?: { area?: string }): HumanError {
  const thing = ctx?.area?.trim() ? ctx.area.trim() : "information";

  switch (kind) {
    case "load":
      return {
        // No "this" before `thing`: `thing` is caller-supplied free text and is
        // often plural ("projects", "employees", "indents"), which "this X" reads
        // as broken ("this projects"). Dropping the determiner reads correctly
        // whether `thing` is singular or plural.
        what: `We couldn't load ${thing}.`,
        // Not "check your internet connection": this fires for any failed load
        // (including a backend/server error), and blaming the clerk's own
        // connection is both misleading and, most of the time, wrong.
        next: "This is usually temporary — try again, or open help if it keeps happening.",
        actions: ["retry", "back", "help"],
      };
    case "save":
      return {
        what: `We couldn't save your ${thing}.`,
        next: "Nothing was changed. Please try again in a moment.",
        actions: ["retry", "help"],
      };
    case "offline":
      return {
        what: "You're offline right now.",
        next: "You can keep viewing saved information. We'll reconnect when your internet is back.",
        actions: ["retry", "help"],
      };
    case "unknownStatus":
      return {
        // Same "this" + plural-`thing` fix as the "load" case above.
        what: `We couldn't check the status of ${thing}.`,
        next: "Please refresh in a moment, or open help if it keeps happening.",
        actions: ["retry", "help"],
      };
    case "accepted":
      return {
        what: "Your request was received.",
        next: "It's being processed now and will appear here shortly.",
        actions: ["back"],
      };
    case "forbidden":
      // Deliberately distinct from "save"/"load": a permission problem is not
      // something retrying will fix, so this is the one kind that never offers
      // "retry" as a safe action.
      return {
        what: "You don't have permission to do this.",
        next: "Ask your administrator if you need access.",
        actions: ["back", "help"],
      };
    case "conflict":
      // GAP-HR-DESIGNATIONS-02: a blocked-by-a-business-rule response (e.g.
      // "still referenced elsewhere, can't delete") is not a transient
      // failure -- like "forbidden", retrying with nothing changed will
      // just fail again the same way, so no "retry" here either. No
      // `thing` interpolation (unlike "load"/"unknownStatus"): the exact
      // dependency varies by caller and the backend's own detail is never
      // echoed to the user (see useFormError.ts's CODE_TO_KIND comment), so
      // this stays generic on purpose.
      return {
        what: "This can't be done while it's still in use elsewhere.",
        next: "Update or reassign whatever depends on it first, then try again.",
        actions: ["back", "help"],
      };
    case "invalid":
      // GAP-PAYROLL-STATUTORY-PT-06: a 400/422 -- the server refused the
      // values themselves. Fixed copy, never the backend's own text (UX-020);
      // retrying unchanged would fail again, so no "retry".
      return {
        what: "Some values were not accepted.",
        next: "Check the highlighted fields and try again.",
        actions: ["back", "help"],
      };
    default:
      return {
        what: "We couldn't complete that.",
        next: "Try again in a few minutes, or open help if it keeps happening.",
        actions: ["retry", "help"],
      };
  }
}

/** Plain labels for the safe actions, for buttons. */
export const ACTION_LABELS: Record<SafeAction, string> = {
  retry: "Try again",
  back: "Go back",
  help: "Open help",
  signin: "Sign in",
};

/**
 * A plain-language prefix for a support reference code (digest), so a bare
 * identifier is never shown without context. Requirement 5.3.
 */
export const SUPPORT_REFERENCE_PREFIX = "If you contact support, quote this code:";

/**
 * The standard, status-aware message (apps/web/docs/ERROR-MESSAGES.md): what
 * happened and what to do next, chosen from a known domain `code` first, then
 * the HTTP status (no status = the request never reached us). Never echoes the
 * status, code or backend text.
 */
export function humanErrorForStatus(
  status: number | undefined,
  ctx?: ErrorContext & { code?: string | null; forceKind?: ErrorStatusKind },
): HumanError {
  const r = resolveHumanError({ status, code: ctx?.code, ctx, forceKind: ctx?.forceKind });
  return { what: r.what, next: r.next, actions: r.actions };
}

/**
 * Which situation a failed loader (fetchJson / LoaderResult) with no HTTP status is in.
 *
 * GAP-UAT-P3-ERRCOPY: a loader that runs on the Next.js server and gets no response
 * from the gateway (timeout, upstream down, a mapper that threw) has NO status. That
 * used to be read as "the request never reached us" and told the officer to check
 * their internet connection -- on a page their browser had just loaded fine (the
 * journal-approvals screen). Rule: "check your internet" only for a genuine
 * browser-side failure, which is the browser reporting it is offline.
 *
 *   status present            -> undefined (the status decides)
 *   browser reports offline   -> "network"
 *   rendering on the server   -> "server"   (the server could not reach the service)
 *   in the browser, online    -> "unknown"  (honest; never blames the connection)
 */
export function loadFailureKind(
  status: number | undefined,
  env: { onServer: boolean; offline: boolean } = {
    onServer: typeof window === "undefined",
    offline: typeof navigator !== "undefined" && navigator.onLine === false,
  },
): ErrorStatusKind | undefined {
  if (status !== undefined && status !== 0) return undefined;
  if (env.offline) return "network";
  return env.onServer ? "server" : "unknown";
}

/**
 * A raw thrown message that is safe to show as-is: a plain-language sentence, not a
 * code, an HTTP status, a stack line or a serialised body. Anything else is replaced by
 * the standard copy (rule 4 of apps/web/docs/ERROR-MESSAGES.md).
 */
export function isPresentableMessage(message: unknown): message is string {
  if (typeof message !== "string") return false;
  const m = message.trim();
  if (m.length < 8 || m.length > 400 || !/\s/.test(m)) return false;
  if (/^(error|typeerror|referenceerror|syntaxerror|rangeerror)\b\s*:?/i.test(m)) return false;
  if (/\b[A-Z][A-Z0-9]+(?:_[A-Z0-9]+)+\b/.test(m)) return false; // SERVICE_CODE
  if (/\b[a-z]+(?:_[a-z0-9]+)+\b/.test(m)) return false; // snake_case key
  if (/\b(?:HTTP|status(?: code)?)\s*[45]\d\d\b|\([45]\d\d\)|\b[45]\d\d (?:Internal|Bad|Not|Forbidden|Unauthorized|Service|Gateway)/i.test(m)) return false;
  if (/^[[{<]/.test(m) || /\bat \S+ \(|undefined|null\b|is not a function|Cannot read propert|Unexpected token|JSON|fetch failed|Failed to fetch/i.test(m)) return false;
  // HTTP reason phrases and transport errors (Internal Server Error, Bad Gateway, timeout of 30000ms exceeded).
  if (/\b(internal server error|bad gateway|service unavailable|gateway time-?out|too many requests|request failed|failed with|server returned|networkerror|network error|timeout of \d+ ?ms|timed out|econn\w*|etimedout|enotfound|socket hang up|stack trace)\b/i.test(m)) return false; // status-leak-ok: rejects raw reason phrases; never rendered
  // A bare reason phrase on its own ("Not Found", "Forbidden").
  if (/^(not found|bad request|unauthori[sz]ed|forbidden|conflict)\.?$/i.test(m)) return false;
  // Any HTTP status number (a 4xx/5xx standing on its own), but not an amount or a count of something.
  if (/(?<![\d₹.,])(?<!\b(?:Rs|INR)\.?\s?)\b[45]\d\d\b(?![.,]\d)(?!\s*(characters?|chars|words|days?|months?|years?|rupees|rs\.?|lakh|crore|%|kb|mb|items?|rows?|employees?|records?|pages?|units?|files?|nos?\.?|ms\b))/i.test(m)) return false;
  // Stack-like lines: "at Foo (file.js:1:2)", "file.ts:12:3", "Error:" anywhere.
  if (/\.(m?[jt]sx?):\d+|\n\s*at\s|\bError:/.test(m)) return false;
  return true;
}

/**
 * The words to show for a thrown value (a rejected mutation, a failed confirm action).
 * A UserFacingError is already standard copy; a dropped connection or a timeout gets its
 * own copy; a bare code ("no_drafts_imported", "BUDGET_EXCEEDED") is looked up in the
 * code map; a plain-language message a caller deliberately threw is kept; anything else
 * (stack text, a raw backend body, "TypeError: x is undefined") becomes the honest
 * "couldn't ..." copy. Never echoes the raw text.
 */
export function messageForThrown(
  err: unknown,
  ctx?: { kind?: MessageKind; area?: string },
): { message: string; reference: string | null; aborted?: true } {
  const kind = ctx?.kind ?? "save";
  const intent = kind === "load" || kind === "unknownStatus" ? "load" : "save";
  const c = classifyThrown(err);
  if (c === "aborted") return { message: "", reference: null, aborted: true };
  if (c === "userFacing") return { message: (err as UserFacingError).message, reference: (err as UserFacingError).reference };
  if (c === "network" || c === "timeout") {
    const h = humanErrorForStatus(undefined, { area: ctx?.area, intent, forceKind: c });
    return { message: `${h.what} ${h.next}`, reference: null };
  }
  const raw = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  const bare = raw.trim().replace(/^error:\s*/i, "");
  // "CODE" alone, or "CODE: developer text" (several services prefix their message with the code).
  const lead = /^([A-Za-z][A-Za-z0-9]*(?:_[A-Za-z0-9]+)+)(?:\s*:.*)?$/s.exec(bare);
  if (lead) {
    const code = lead[1].toUpperCase();
    // Only a hand-written entry explains a bare code; a naming family alone is too weak without a status.
    const known = resolveServiceCode(code)?.source === "explicit" || Object.prototype.hasOwnProperty.call(DOMAIN_CODE_MESSAGES, code);
    const h = humanErrorForStatus(undefined, { area: ctx?.area, intent, code, ...(known ? {} : { forceKind: "unknown" as const }) });
    return { message: `${h.what} ${h.next}`, reference: null };
  }
  if (isPresentableMessage(raw)) return { message: raw.trim(), reference: null };
  const h = humanErrorForStatus(undefined, { area: ctx?.area, intent, forceKind: "unknown" });
  return { message: `${h.what} ${h.next}`, reference: null };
}

/** Backend codes that mean one specific situation whatever the HTTP status says. */
const CODE_TO_STATUS_KIND: Record<string, ErrorStatusKind> = {
  VALIDATION_FAILED: "validation",
  VALIDATION_ERROR: "validation",
  NOT_FOUND: "notFound",
  FORBIDDEN: "forbidden",
};

/**
 * One call for every failed-request helper: status + backend `code` + the
 * caller's legacy `kind`/`area` -> the standard message. A domain code wins,
 * then a code that pins a situation, then an explicit "forbidden" / "conflict"
 * / "offline" `kind` (only for a non-5xx status), then the HTTP status.
 */
export function humanErrorFromFailure(input: {
  status?: number;
  code?: string | null;
  kind?: MessageKind;
  area?: string;
  /** For a 413: the allowed size, e.g. "5 MB". */
  limit?: string;
  /** For a 415: the accepted types, e.g. "PDF or JPG". */
  types?: string;
  /** Pin the situation (e.g. "network" for a thrown fetch). */
  forceKind?: ErrorStatusKind;
  /** The failure carries field-level messages (400/422 copy then says "highlighted fields"). */
  hasFieldErrors?: boolean;
}): HumanError {
  const { status, code, kind, area, limit, types, hasFieldErrors } = input;
  const intent = kind === "load" || kind === "unknownStatus" ? "load" : "save";
  let forceKind: ErrorStatusKind | undefined = input.forceKind ?? (code ? CODE_TO_STATUS_KIND[code] : undefined);
  const clientSide = status === undefined || status < 500;
  if (!forceKind && kind === "forbidden" && clientSide) forceKind = "forbidden";
  if (!forceKind && kind === "conflict" && clientSide) forceKind = "conflict";
  if (!forceKind && kind === "offline") forceKind = "network";
  return humanErrorForStatus(status, { area, intent, code, forceKind, limit, types, hasFieldErrors });
}
