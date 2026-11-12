/**
 * Meilisearch tenant token (HS256 JWT) — a signed, expiring search credential whose `searchRules` carry a filter the
 * HOLDER CANNOT REMOVE OR WIDEN: the engine ANDs it onto every request made with the token. The gateway mints one per
 * request from the caller's JWT tenant, so even a defect in the query-filter builder cannot read another tenant.
 *
 * Needs a SEARCH-ONLY API key (uid + key value) created once by an operator; the master key is never used for it.
 */
import { createHmac } from "node:crypto";
import { UUID_RE } from "./contract.js";

export interface TenantTokenInput {
  /** Value of the search-only API key (signing secret). */
  apiKey: string;
  /** uid of that API key (a public identifier, not a secret). */
  keyUid: string;
  tenantId: string;
  indexName: string;
  /** Unix seconds. */
  expiresAtSec: number;
}

/** JWT claim name Meilisearch requires for the uid of the signing key. */
const KEY_UID_CLAIM = "apiKeyUid";

const b64url = (buf: Buffer | string): string => Buffer.from(buf).toString("base64url");

export function tenantFilterRule(tenantId: string): string {
  if (!UUID_RE.test(tenantId)) throw new Error("tenantId must be a UUID");
  return `tenantId = "${tenantId.toLowerCase()}"`;
}

export function createTenantToken(input: TenantTokenInput): string {
  const header = b64url(JSON.stringify({ typ: "JWT", alg: "HS256" }));
  const payload = b64url(
    JSON.stringify({
      [KEY_UID_CLAIM]: input.keyUid,
      searchRules: { [input.indexName]: { filter: tenantFilterRule(input.tenantId) } },
      exp: input.expiresAtSec,
    }),
  );
  const sig = createHmac("sha256", input.apiKey).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${sig}`;
}
