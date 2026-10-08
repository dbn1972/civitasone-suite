/**
 * GAP-CITIZEN-DOCUMENTS-02 — OAuth2 Authorization-Code + PKCE helpers for the
 * DigiLocker consent redirect. Pure crypto, no I/O.
 *
 * The `state` is a high-entropy opaque token bound server-side to
 * {tenant, actor, citizen, docType, purpose}; the PKCE `code_verifier` is
 * stored server-side and NEVER sent to the browser — only its S256 challenge
 * travels in the authorize URL — so a stolen authorization code cannot be
 * exchanged without the server-held verifier (RFC 7636).
 */
import { randomBytes, createHash } from "node:crypto";

const base64url = (b: Buffer): string =>
  b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** 43–128 char high-entropy PKCE code verifier (RFC 7636 §4.1). */
export function generateCodeVerifier(): string {
  return base64url(randomBytes(48));
}

/** S256 code challenge for a verifier (RFC 7636 §4.2). */
export function codeChallengeS256(verifier: string): string {
  return base64url(createHash("sha256").update(verifier).digest());
}

/** High-entropy opaque OAuth state token. */
export function generateState(): string {
  return base64url(randomBytes(32));
}

export interface PkceMaterial {
  state: string;
  codeVerifier: string;
  codeChallenge: string;
}

export function newPkceMaterial(): PkceMaterial {
  const codeVerifier = generateCodeVerifier();
  return { state: generateState(), codeVerifier, codeChallenge: codeChallengeS256(codeVerifier) };
}
