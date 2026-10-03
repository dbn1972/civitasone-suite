/**
 * Browser-native API client — routes through BFF /api/proxy (httpOnly session).
 * Adds device + trust headers for Gmail-style security layers.
 */
import { getOrCreateDeviceId } from "@civitasone/client-core";
import { humanErrorFromFailure, type MessageKind } from "../messages";
import { referenceFromHeaders } from "../errorCatalogue";
import { UserFacingError, isNetworkFailure } from "../userFacingError";
import { readFailureBody } from "./userFacingFromResponse";

export { UserFacingError, referenceFromError, isNetworkFailure } from "../userFacingError";

const TRUST_KEY = "civitasone_device_trust";

function deviceHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "x-device-id": getOrCreateDeviceId(),
  };
  if (typeof sessionStorage !== "undefined") {
    const trust = sessionStorage.getItem(TRUST_KEY);
    if (trust) headers["x-device-trust-token"] = trust;
  }
  return headers;
}

export async function browserFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const normalized = path.startsWith("/") ? path.slice(1) : path;
  try {
    return await fetch(`/api/proxy/${normalized}`, {
      ...init,
      credentials: "same-origin",
      headers: {
        "content-type": "application/json",
        ...deviceHeaders(),
        ...(init.headers as Record<string, string> | undefined),
      },
    });
  } catch (err) {
    // A fetch that never got a response rejects with a raw browser TypeError
    // ("Failed to fetch"). Callers render `e.message`, so convert it here to the
    // standard network copy. A caller-initiated abort is left alone: callers
    // check for AbortError and must still see it.
    const name = (err as { name?: unknown } | null)?.name;
    if (isNetworkFailure(err) && name !== "AbortError") {
      const human = humanErrorFromFailure({ kind: "offline" });
      throw new UserFacingError(`${human.what} ${human.next}`);
    }
    throw err;
  }
}

/**
 * Build a user-safe error string for a failed Response using the app-wide error
 * standard (apps/web/docs/ERROR-MESSAGES.md): status-aware by default, with a
 * known domain `code` winning over the generic status copy. The backend's own
 * text, the code and the HTTP status are never shown (UX-020).
 *
 * `kind`/`area` steer the wording like `useFormError.fromResponse`'s own
 * parameters; both are optional. An explicit "forbidden" / "conflict" /
 * "offline" `kind` is honoured when it is more specific than the status.
 */
export async function errorMessageFromResponse(
  res: Response,
  kind?: MessageKind,
  area?: string,
): Promise<string> {
  const { code, hasFieldErrors } = await readFailureBody(res);
  const human = humanErrorFromFailure({ status: res.status, code, kind, area, hasFieldErrors });
  return `${human.what} ${human.next}`;
}

/** The status-aware message is now the default; kept as an alias for callers that opted in explicitly. */
export const errorMessageForStatus = (res: Response, area?: string): Promise<string> =>
  errorMessageFromResponse(res, undefined, area);

/**
 * The machine-readable `code` from a failed API response body (e.g.
 * "SELF_DISBURSE_FORBIDDEN"), or null when absent/unparseable. For callers
 * that map a few KNOWN codes to their own translated copy -- never display
 * the code itself; fall back to errorMessageFromResponse for anything else.
 * Reads a clone, so the response can still be consumed afterwards.
 */
export async function errorCodeFromResponse(res: Response): Promise<string | null> {
  try {
    const body = (await res.clone().json()) as { code?: unknown } | null;
    return body && typeof body.code === "string" ? body.code : null;
  } catch {
    return null;
  }
}

export async function browserJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await browserFetch(path, init);
  if (!res.ok) throw new UserFacingError(await errorMessageFromResponse(res), referenceFromHeaders(res.headers));
  return res.json() as Promise<T>;
}

/** Request step-up token for sensitive mutations (finance approvals, etc.). */
export async function requestStepUp(): Promise<string> {
  const res = await browserFetch("v1/devices/step-up", { method: "POST" });
  if (!res.ok) throw new Error("STEP_UP_REQUIRED");
  const data = (await res.json()) as { stepUpToken: string };
  return data.stepUpToken;
}
