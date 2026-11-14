/**
 * Coded refusals of POST /v1/meeting/:id/agenda[/late]. Kept apart from client.ts (like errorText.ts) so
 * tests that mock the client module still get the real class and guard.
 *
 * The service answers 422 synchronously: MEETING_PAST_DEADLINE (with the cut-off in `details.deadline`)
 * and MEETING_AGENDA_LOCKED. The console renders them in the user's language from the code, never from the
 * English server text.
 */
import { UserFacingError } from "@/lib/userFacingError";

export const AGENDA_EXPLAINED_CODES = [
  "MEETING_PAST_DEADLINE",
  "MEETING_AGENDA_LOCKED",
  // Late-inclusion decisions: maker != checker, and a request someone else already decided.
  "SELF_APPROVAL_FORBIDDEN",
  "LATE_REQUEST_ALREADY_DECIDED",
] as const;
export type AgendaExplainedCode = (typeof AGENDA_EXPLAINED_CODES)[number];

export class AgendaSubmitError extends UserFacingError {
  constructor(
    public readonly code: AgendaExplainedCode,
    message: string,
    /** ISO-8601 submission cut-off, for MEETING_PAST_DEADLINE. */
    public readonly deadline: string | null = null,
  ) {
    super(message);
    this.name = "AgendaSubmitError";
  }
}

/** Narrow a caught value to a coded agenda refusal (duck-typed so a mocked client cannot defeat it). */
export function asAgendaSubmitError(err: unknown): AgendaSubmitError | null {
  const e = err as { name?: unknown; code?: unknown } | null;
  return e && e.name === "AgendaSubmitError" && typeof e.code === "string" ? (err as AgendaSubmitError) : null;
}

/** Read `{ code, details }` from either the flat or the `{ error: {...} }` body shape. */
export async function readAgendaRefusal(res: Response): Promise<{ code: AgendaExplainedCode; deadline: string | null } | null> {
  let j: unknown;
  try { j = await res.json(); } catch { return null; }
  // The shared error handler (packages/schemas http.ts) spreads `details` into the TOP LEVEL of the body:
  // { code, message, deadline, scheduledAt, ... }. The nested `{ error: { details } }` envelope is also read.
  const o = (j ?? {}) as { code?: unknown; deadline?: unknown; details?: { deadline?: unknown }; error?: { code?: unknown; details?: { deadline?: unknown } } };
  const code = typeof o.code === "string" ? o.code : typeof o.error?.code === "string" ? o.error.code : "";
  if (!(AGENDA_EXPLAINED_CODES as readonly string[]).includes(code)) return null;
  const d = o.deadline ?? o.details?.deadline ?? o.error?.details?.deadline;
  return { code: code as AgendaExplainedCode, deadline: typeof d === "string" ? d : null };
}
