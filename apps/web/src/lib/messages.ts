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
  | "accepted";

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
        what: `We couldn't load this ${thing}.`,
        next: "Check your internet connection and try again.",
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
        what: `We couldn't check the status of this ${thing}.`,
        next: "Please refresh in a moment, or open help if it keeps happening.",
        actions: ["retry", "help"],
      };
    case "accepted":
      return {
        what: "Your request was received.",
        next: "It's being processed now and will appear here shortly.",
        actions: ["back"],
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
