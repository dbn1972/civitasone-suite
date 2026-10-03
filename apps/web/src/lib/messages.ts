/**
 * One plain-language vocabulary for everything that can go wrong, so a clerk
 * never sees raw server text, HTTP status codes, stack traces, or developer
 * phrasing. Every message says what happened and what to do next, and offers at
 * least one safe action. Requirements 5 and 6.
 */

export type SafeAction = "retry" | "back" | "help";

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
        next: "Contact your administrator if you think this is a mistake.",
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
        what: "Something went wrong.",
        next: "Please try again, or open help if it keeps happening.",
        actions: ["retry", "help"],
      };
  }
}

/** Plain labels for the safe actions, for buttons. */
export const ACTION_LABELS: Record<SafeAction, string> = {
  retry: "Try again",
  back: "Go back",
  help: "Open help",
};

/**
 * A plain-language prefix for a support reference code (digest), so a bare
 * identifier is never shown without context. Requirement 5.3.
 */
export const SUPPORT_REFERENCE_PREFIX = "If you contact support, quote this code:";
