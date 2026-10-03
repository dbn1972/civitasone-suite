import { humanErrorFromFailure, type MessageKind } from "../messages";
import { referenceFromHeaders } from "../errorCatalogue";
import { UserFacingError } from "../userFacingError";

/** The only parts of an error body the UI may act on: the code (as a lookup key) and whether field messages exist. */
export async function readFailureBody(res: Response): Promise<{ code: string | null; hasFieldErrors: boolean }> {
  try {
    const body = (await res.clone().json()) as { code?: unknown; fieldErrors?: unknown } | null;
    return {
      code: body && typeof body.code === "string" ? body.code : null,
      hasFieldErrors: Array.isArray(body?.fieldErrors) && (body?.fieldErrors as unknown[]).length > 0,
    };
  } catch {
    return { code: null, hasFieldErrors: false };
  }
}

/**
 * Turn a failed fetch `Response` into a UserFacingError carrying the standard,
 * status-aware message (apps/web/docs/ERROR-MESSAGES.md) and the support
 * reference. Use instead of `throw await userFacingErrorFromResponse(res, "save")`, which put the
 * raw backend body on screen. Dependency-light on purpose (no browserClient
 * import) so tests that mock browserClient are unaffected.
 */
export async function userFacingErrorFromResponse(
  res: Response,
  kind: MessageKind = "save",
  area?: string,
): Promise<UserFacingError> {
  const { code, hasFieldErrors } = await readFailureBody(res);
  const human = humanErrorFromFailure({ status: res.status, code, kind, area, hasFieldErrors });
  return new UserFacingError(`${human.what} ${human.next}`, referenceFromHeaders(res.headers));
}
