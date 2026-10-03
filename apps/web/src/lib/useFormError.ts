"use client";

import { useCallback, useState } from "react";
import { humanErrorFromFailure, type MessageKind } from "./messages";
import { referenceFromHeaders } from "./errorCatalogue";
import { UserFacingError, isNetworkFailure } from "./userFacingError";

/**
 * Per-field message from a backend validation failure. Backend services
 * author these strings themselves (e.g. "Name must be under 100 characters")
 * as human-safe copy, so — unlike the top-level `message`/`code` below —
 * they are shown to the user as-is, exactly like the one existing correct
 * consumer of this envelope (locations/list/LocationActions.tsx).
 */
export type FieldError = { field: string; message: string };

/** The standard error envelope backend services in this repo return on a failed request. */
export type ErrorEnvelope = {
  code?: string;
  message?: string;
  fieldErrors?: FieldError[];
};

export type FormErrorState = {
  /** Plain-language summary for the top of the form. NEVER raw server text or an HTTP status code. */
  message: string;
  /** field name -> plain-language inline message, taken straight from the backend's `fieldErrors`. */
  fieldErrors: Record<string, string>;
  /** Support reference (correlation / request id) when the response carried one; show it de-emphasised, never as the message. */
  reference: string | null;
};

const EMPTY_STATE: FormErrorState = { message: "", fieldErrors: {}, reference: null };

/*
 * Wording comes from the app-wide standard (lib/errorCatalogue.ts, documented in
 * apps/web/docs/ERROR-MESSAGES.md): a known domain `code` first (e.g.
 * SELF_APPROVAL_FORBIDDEN, DESIGNATION_IN_USE, DUPLICATE_CODE), then the HTTP
 * status. Add new domain codes to DOMAIN_CODE_MESSAGES there.
 *
 * NEVER add a branch here (or anywhere in this file) that echoes `code`,
 * `message`, or the HTTP status back to the user — that is exactly the bug
 * this hook exists to close. See docs/ENTERPRISE-GAP-REPORT-2026-09-07.md UX-003.
 */

/**
 * Parse the standard backend error envelope. Never throws, and never leaks
 * the raw response body: a non-JSON or unrecognized body resolves to `{}`,
 * which drives the caller to the catalogued toHumanError copy instead.
 */
async function parseErrorEnvelope(res: Response): Promise<ErrorEnvelope> {
  let text = "";
  try {
    text = await res.text();
  } catch {
    return {};
  }
  try {
    const body = JSON.parse(text) as ErrorEnvelope;
    if (body && typeof body === "object" && (body.message || body.code || body.fieldErrors)) {
      return body;
    }
  } catch {
    // Not JSON — a proxy/gateway plain-text failure, an HTML error page, a
    // stack trace, etc. Deliberately discarded.
  }
  return {};
}

export type UseFormErrorResult = FormErrorState & {
  /** Field-level message, if any, for `field`. */
  fieldError: (field: string) => string | undefined;
  /**
   * Read a failed fetch `Response` and populate `message` / `fieldErrors`.
   * The wording follows the status-aware standard; `kind` only steers the verb
   * (load vs save) and lets a caller pin "forbidden"/"conflict". Returns the resolved state for callers
   * that also want to branch on it synchronously (e.g. to open a dialog).
   */
  fromResponse: (res: Response, kind?: MessageKind, extra?: { limit?: string; types?: string }) => Promise<FormErrorState>;
  /**
   * Populate `message` for a caught exception. Pass the caught value as `err`:
   * a UserFacingError (thrown by `browserJson` for a failed response) keeps its
   * status-aware standard message and reference; a failed fetch (TypeError /
   * AbortError / TimeoutError) reads "We couldn't connect". With no `err` the
   * cause is unknown, so the copy is honest about it. Never reads `err.message`
   * of anything but a UserFacingError.
   */
  fromException: (kind?: MessageKind, err?: unknown) => FormErrorState;
  /** Reset to the empty state (call before a new submit attempt). */
  clear: () => void;
};

/**
 * Shared form-error handling for this app: maps a backend `fieldErrors`
 * array to inline field messages, and a `code` (or a network exception) to a
 * `toHumanError` summary line. Never surfaces a raw HTTP status code or raw
 * server error text — see docs/ENTERPRISE-GAP-REPORT-2026-09-07.md UX-003.
 *
 * `area` is the plain noun passed through to `toHumanError` (e.g. "indent",
 * "payroll run") to make the summary copy specific.
 */
export function useFormError(area: string): UseFormErrorResult {
  const [state, setState] = useState<FormErrorState>(EMPTY_STATE);

  const clear = useCallback(() => setState(EMPTY_STATE), []);

  const fromResponse = useCallback(
    async (res: Response, kind: MessageKind = "save", extra?: { limit?: string; types?: string }) => {
      const env = await parseErrorEnvelope(res);
      const fieldErrors = env.fieldErrors?.length
        ? Object.fromEntries(env.fieldErrors.map((f) => [f.field, f.message]))
        : {};
      const human = humanErrorFromFailure({ status: res.status, code: env.code, kind, area, hasFieldErrors: Object.keys(fieldErrors).length > 0, ...extra });
      const next: FormErrorState = {
        message: `${human.what} ${human.next}`,
        fieldErrors,
        reference: referenceFromHeaders(res.headers),
      };
      setState(next);
      return next;
    },
    [area],
  );

  const fromException = useCallback(
    (kind: MessageKind = "save", err?: unknown) => {
      let next: FormErrorState;
      if (err instanceof UserFacingError) {
        next = { message: err.message, fieldErrors: {}, reference: err.reference };
      } else {
        // A fetch that never got a response is a connection problem; a thrown
        // error we cannot classify (or no error passed) stays honest about not
        // knowing. This hook never touches form values, so input is kept.
        const network = err !== undefined && isNetworkFailure(err);
        const human = humanErrorFromFailure({ kind: kind === "load" ? "load" : "save", area, forceKind: network ? "network" : "unknown" });
        next = { message: `${human.what} ${human.next}`, fieldErrors: {}, reference: null };
      }
      setState(next);
      return next;
    },
    [area],
  );

  return {
    ...state,
    fieldError: (field: string) => state.fieldErrors[field],
    fromResponse,
    fromException,
    clear,
  };
}
