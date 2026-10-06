/**
 * identity route-group server loaders — SCORE_LOCK F1 child pages.
 * Calls identity-service through the gateway via cookie-aware fetchJson.
 */
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import type { ModuleRowSummary } from "@civitasone/types";
import { formatIndianDate } from "@/lib/formatters";
import { z } from "zod";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toText(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return undefined;
}

// GAP-IDENTITY-{API-KEYS,BREAKGLASS,SESSIONS,USERS,WEBAUTHN}-04: a value that
// LOOKS like a full ISO timestamp ("2026-09-28T09:14:22Z") is rendered as a
// readable Indian date ("28 Sep 2026") instead of raw machine text. A bare
// calendar date or any non-ISO value is passed through unchanged (formatMoney
// codes, currency, etc. must not be mangled).
const ISO_INSTANT_RE = /^\d{4}-\d{2}-\d{2}T/;
function formatMetaValue(value: string): string {
  return ISO_INSTANT_RE.test(value) ? formatIndianDate(value) : value;
}

function extractRows(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!isRecord(payload)) return [];
  for (const key of ["data", "items", "resources", "rows", "results", "nodes", "changes", "breakers"]) {
    if (Array.isArray(payload[key])) return payload[key] as unknown[];
  }
  if (isRecord(payload.data)) return [payload.data];
  return [payload];
}

/**
 * Exported for unit testing (GAP-IDENTITY-*-04 / API-KEYS-03). The generic
 * row mapper shared by the identity list loaders.
 */
export function mapRows(payload: unknown): ModuleRowSummary[] {
  const mapped: ModuleRowSummary[] = [];
  for (const [index, row] of extractRows(payload).entries()) {
    if (!isRecord(row)) continue;
    const id =
      toText(row.id) ??
      // GAP-IDENTITY-API-KEYS-03 (web defence-in-depth): `row.key` was in this
      // fallback chain, so if the admin api-keys endpoint ever returned secret
      // material under `key` without an `id`, the first 8 chars of the SECRET
      // would be printed in the ID column and cached offline. The backend list
      // response is confirmed to expose only id/name/keyPrefix/scopes/status/
      // timestamps (services/identity-service apikeys repo.toView — no key/
      // secret/hash field), and this pinning test proves it; dropping `row.key`
      // here means a future regression that reintroduced a secret could never
      // leak it through this shared mapper.
      toText(row.code) ??
      toText(row.name) ??
      toText(row.agentId) ??
      toText(row.profileId) ??
      toText(row.accountId) ??
      toText(row.conversationId) ??
      `row-${index + 1}`;
    const label =
      toText(row.name) ??
      toText(row.title) ??
      toText(row.label) ??
      toText(row.code) ??
      toText(row.type) ??
      toText(row.entityType) ??
      toText(row.direction) ??
      id;
    // GAP-IDENTITY-{API-KEYS,BREAKGLASS,SESSIONS,USERS,WEBAUTHN}-04: Detail no
    // longer falls back to status/state — that made the Detail column simply
    // repeat the Status column whenever a row had no description. Detail now
    // shows a real descriptive field or "—".
    const sublabel =
      toText(row.description) ??
      toText(row.category) ??
      toText(row.tier) ??
      toText(row.programName);
    const status = toText(row.status) ?? toText(row.state) ?? toText(row.lifecycle);
    const metaRaw =
      toText(row.code) ??
      toText(row.currency) ??
      toText(row.updatedAt) ??
      toText(row.createdAt) ??
      (typeof row.points === "number" ? `${row.points} pts` : undefined) ??
      (typeof row.balance === "number" ? `bal ${row.balance}` : undefined);
    const meta = metaRaw !== undefined ? formatMetaValue(metaRaw) : undefined;
    mapped.push({
      id,
      label,
      ...(sublabel ? { sublabel } : {}),
      ...(status ? { status } : {}),
      ...(meta ? { meta } : {}),
    });
  }
  return mapped;
}

function moduleLoader(path: string, key: string) {
  return (): Promise<LoaderResult<ModuleRowSummary[]>> =>
    fetchJson<unknown, ModuleRowSummary[]>(path, [] as ModuleRowSummary[], {
      revalidateSeconds: 30,
      telemetryKey: key,
      mapResponse: mapRows,
    });
}

export const getIdentityUsers = moduleLoader("/api/identity/users", "identity.users");
export const getIdentitySessions = moduleLoader("/api/identity/sessions", "identity.sessions");
export const getIdentityApiKeys = moduleLoader("/api/v1/admin/api-keys", "identity.api-keys");
export const getIdentityBreakglass = moduleLoader("/api/v1/admin/breakglass", "identity.breakglass");
export const getIdentityWebauthn = moduleLoader("/api/v1/identity/webauthn/credentials", "identity.webauthn");

/**
 * GAP-IDENTITY-WEBAUTHN-03: a typed, zod-parsed passkey loader for the
 * PasskeyManager. The generic mapRows above dropped last-used / registered
 * dates and the device label; this keeps exactly the fields the identity-
 * service credentials endpoint actually returns (verified against
 * services/identity-service/src/modules/webauthn/routes.ts GET
 * /v1/identity/webauthn/credentials: { data: [{ id, deviceName?, createdAt,
 * lastUsedAt? }], total }). The endpoint is self-scoped (ctx.actorId), so
 * these are the signed-in user's own passkeys — the page is titled accordingly.
 */
export interface WebauthnCredential {
  id: string;
  deviceName: string | null;
  createdAt: string;
  lastUsedAt: string | null;
}

const WebauthnCredentialSchema = z.object({
  id: z.string(),
  deviceName: z.string().nullish().transform((v) => v ?? null),
  createdAt: z.string(),
  lastUsedAt: z.string().nullish().transform((v) => v ?? null),
});

const WebauthnCredentialsResponseSchema = z.object({
  data: z.array(WebauthnCredentialSchema),
  total: z.number().optional(),
});

export function getIdentityWebauthnCredentials(): Promise<LoaderResult<WebauthnCredential[]>> {
  return fetchJson<z.infer<typeof WebauthnCredentialsResponseSchema>, WebauthnCredential[]>(
    "/api/v1/identity/webauthn/credentials",
    [] as WebauthnCredential[],
    {
      revalidateSeconds: 30,
      telemetryKey: "identity.webauthn.credentials",
      responseSchema: WebauthnCredentialsResponseSchema,
      mapResponse: (payload) => payload.data,
    },
  );
}
