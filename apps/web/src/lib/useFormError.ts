"use client";

import { useCallback, useState } from "react";
import { toHumanError, type MessageKind } from "./messages";

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
};

const EMPTY_STATE: FormErrorState = { message: "", fieldErrors: {} };

/**
 * Backend error `code` -> the MessageKind used to build the summary line.
 * Extend this table as new codes get catalogued. Anything not listed here
 * falls back to the `kind` the caller passed to `fromResponse` (default "save").
 *
 * NEVER add a branch here (or anywhere in this file) that echoes `code`,
 * `message`, or the HTTP status back to the user — that is exactly the bug
 * this hook exists to close. See docs/ENTERPRISE-GAP-REPORT-2026-09-07.md UX-003.
 */
const CODE_TO_KIND: Record<string, MessageKind> = {
  VALIDATION_FAILED: "save",
  VALIDATION_ERROR: "save",
  NOT_FOUND: "load",
  // SF-14: a 403 gets its own clerk-safe "you don't have permission" copy,
  // distinct from a generic save/validation failure -- see messages.ts's
  // "forbidden" MessageKind. Confirmed against real backend responses (e.g.
  // lib/cdp/steward.ts, lib/crm/opportunityHttp.ts): services in this repo
  // send `{ code: "FORBIDDEN" }` on a 403, so this is reached the same way
  // as every other cataloged code, no HTTP-status fallback needed here.
  FORBIDDEN: "forbidden",
  // GAP-HR-DESIGNATIONS-02: DELETE /v1/hrms/designations/:id 409s with this
  // code when an employee still holds the designation.
  DESIGNATION_IN_USE: "conflict",
  // GAP-HR-DEPARTMENTS-NEW-02 / GAP-HR-DESIGNATIONS-NEW-02: POST .../departments
  // and .../designations both 409 with this code on a case-insensitive
  // duplicate code; the field-level message (under Code) comes from
  // `fieldErrors` regardless, this only shapes the top-of-form summary line.
  DUPLICATE_CODE: "conflict",
  // fin-hr-02: duplicate shift name (GAP-HR-SHIFTS-01) / duplicate transfer
  // order number (GAP-HR-TRANSFER-02) -- both are 409 "already exists" cases.
  SHIFT_NAME_EXISTS: "conflict",
  ORDER_NO_EXISTS: "conflict",
};

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
   * `kind` is the fallback MessageKind used when the response's `code` isn't
   * in CODE_TO_KIND (default "save"). Returns the resolved state for callers
   * that also want to branch on it synchronously (e.g. to open a dialog).
   */
  fromResponse: (res: Response, kind?: MessageKind) => Promise<FormErrorState>;
  /** Populate `message` for a caught network/fetch exception. Never reads `err.message`. */
  fromException: (kind?: MessageKind) => FormErrorState;
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
    async (res: Response, kind: MessageKind = "save") => {
      const env = await parseErrorEnvelope(res);
      const fieldErrors = env.fieldErrors?.length
        ? Object.fromEntries(env.fieldErrors.map((f) => [f.field, f.message]))
        : {};
      // GAP-FINANCE-EXPENDITURE-ADVANCES-NEW-05: a 403 from the gateway/proxy
      // often carries no JSON envelope (so no FORBIDDEN code to map); the HTTP
      // status alone must still say "no permission", never "try again".
      const resolvedKind = (env.code && CODE_TO_KIND[env.code]) || (res.status === 403 ? "forbidden" : kind);
      const human = toHumanError(resolvedKind, { area });
      const next: FormErrorState = { message: `${human.what} ${human.next}`, fieldErrors };
      setState(next);
      return next;
    },
    [area],
  );

  const fromException = useCallback(
    (kind: MessageKind = "save") => {
      const human = toHumanError(kind, { area });
      const next: FormErrorState = {
        message: `${human.what} Check your internet connection and try again.`,
        fieldErrors: {},
      };
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
