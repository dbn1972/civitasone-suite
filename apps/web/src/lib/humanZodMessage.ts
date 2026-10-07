import { toHumanError } from "@/lib/messages";

/**
 * Zod's built-in (un-authored) copy: "Required", "Invalid input",
 * "Expected number, received nan", "String must contain at least ...".
 * These are developer text and must never reach a clerk.
 */
const ZOD_DEFAULT = /^(Required$|Invalid\b|Expected\b|String must\b|Number must\b|Array must\b|Too (small|big)\b|Unrecognized key)/;

/**
 * Clerk-safe line for a failed client-side zod parse. A message the schema
 * author wrote (e.g. "Choose a work.") is shown as-is; zod's default text is
 * replaced by the catalogued "invalid" copy via toHumanError.
 */
export function humanZodMessage(issue: { message?: string } | undefined): string {
  const msg = issue?.message?.trim();
  if (msg && !ZOD_DEFAULT.test(msg)) return msg;
  const h = toHumanError("invalid");
  return `${h.what} ${h.next}`;
}
