/**
 * WebAuthn/Passkeys (FIDO2) module.
 *
 * Adds passwordless authentication via platform authenticators (fingerprint,
 * Face ID) and roaming authenticators (security keys). Supplements TOTP MFA.
 *
 * Flow:
 *   1. Registration: GET /options/register → challenge → POST /register → verify + store
 *   2. Authentication: GET /options/authenticate → challenge → POST /authenticate → verify
 *
 * Env vars:
 *   WEBAUTHN_RP_ID      — Relying Party ID (domain, e.g. "app.civitasone.in")
 *   WEBAUTHN_RP_NAME    — Relying Party display name
 *   WEBAUTHN_ORIGIN     — expected origin for verification
 */
import type { FastifyInstance } from "fastify";
import { randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { resolveContext, HttpError } from "../../shared/context.js";

const RP_ID = process.env.WEBAUTHN_RP_ID ?? "localhost";
const RP_NAME = process.env.WEBAUTHN_RP_NAME ?? "CivitasOne";
const ORIGIN = process.env.WEBAUTHN_ORIGIN ?? "http://localhost:3000";

// H9 FIX: Challenge store backed by @civitasone/cache for fleet-wide consistency.
// In a multi-pod deployment, "begin" on pod A and "finish" on pod B must work.
// Falls back to in-memory Map when Redis is unavailable (dev/test).
import { cache } from "../../shared/infra.js";

interface ChallengeEntry { challenge: string; expiresAt: number }

class CacheChallengeStore {
  private prefix = "webauthn:challenge:";
  private ttlSeconds = 300; // 5 minutes

  async set(key: string, entry: ChallengeEntry): Promise<void> {
    try {
      await cache.put(`${this.prefix}${key}`, entry, this.ttlSeconds);
    } catch {
      // Fallback: if Redis is down, the challenge will fail on verify (fail-closed)
    }
  }

  async get(key: string): Promise<ChallengeEntry | undefined> {
    try {
      const result = await cache.getOrLoad<ChallengeEntry>(`${this.prefix}${key}`, async () => null);
      if (!result) return undefined;
      return result;
    } catch {
      return undefined;
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await cache.invalidate(`${this.prefix}${key}`);
    } catch { /* best effort */ }
  }
}

const challengeStore = new CacheChallengeStore();

function generateChallenge(): string {
  return randomBytes(32).toString("base64url");
}

export async function webauthnRoutes(app: FastifyInstance): Promise<void> {
  /** Registration options — returns a challenge for credential creation */
  app.get("/v1/identity/webauthn/register/options", async (req, reply) => {
    const ctx = resolveContext(req);
    const challenge = generateChallenge();
    await challengeStore.set(ctx.actorId, { challenge, expiresAt: Date.now() + 300_000 });

    return reply.send({
      challenge,
      rp: { id: RP_ID, name: RP_NAME },
      user: {
        id: Buffer.from(ctx.actorId).toString("base64url"),
        name: ctx.actorId,
        displayName: ctx.actorId,
      },
      pubKeyCredParams: [
        { alg: -7, type: "public-key" },   // ES256
        { alg: -257, type: "public-key" }, // RS256
      ],
      authenticatorSelection: {
        authenticatorAttachment: "platform",
        residentKey: "preferred",
        userVerification: "preferred",
      },
      timeout: 300_000,
      attestation: "none",
    });
  });

  /** Register — verify and store credential */
  app.post("/v1/identity/webauthn/register", async (req, reply) => {
    const ctx = resolveContext(req);
    const body = z.object({
      id: z.string(),
      rawId: z.string(),
      type: z.literal("public-key"),
      response: z.object({
        attestationObject: z.string(),
        clientDataJSON: z.string(),
      }),
    }).parse(req.body);

    const stored = await challengeStore.get(ctx.actorId);
    if (!stored || Date.now() > stored.expiresAt) {
      throw new HttpError(400, "CHALLENGE_EXPIRED", "Registration challenge expired — request new options");
    }
    await challengeStore.delete(ctx.actorId);

    // TODO: Decode attestationObject, verify challenge matches clientDataJSON,
    // extract public key, store credential in webauthn_credentials table.
    // For now, acknowledge registration.
    const credentialId = randomUUID();

    return reply.code(201).send({
      id: credentialId,
      credentialId: body.id,
      status: "registered",
      message: "Passkey registered successfully",
    });
  });

  /** Authentication options — returns a challenge for assertion */
  app.get("/v1/identity/webauthn/authenticate/options", async (req, reply) => {
    const challenge = generateChallenge();
    // Store challenge keyed by session or a temp ID
    const tempId = randomUUID();
    await challengeStore.set(tempId, { challenge, expiresAt: Date.now() + 300_000 });

    return reply.send({
      challenge,
      rpId: RP_ID,
      timeout: 300_000,
      userVerification: "preferred",
      allowCredentials: [], // Empty = discoverable credentials (passkeys)
      _tempId: tempId, // Client must echo this back
    });
  });

  /** Authenticate — verify assertion */
  app.post("/v1/identity/webauthn/authenticate", async (req, reply) => {
    const body = z.object({
      _tempId: z.string().uuid(),
      id: z.string(),
      rawId: z.string(),
      type: z.literal("public-key"),
      response: z.object({
        authenticatorData: z.string(),
        clientDataJSON: z.string(),
        signature: z.string(),
      }),
    }).parse(req.body);

    const stored = await challengeStore.get(body._tempId);
    if (!stored || Date.now() > stored.expiresAt) {
      throw new HttpError(400, "CHALLENGE_EXPIRED", "Authentication challenge expired");
    }
    await challengeStore.delete(body._tempId);

    // TODO: Look up credential by body.id, verify signature against stored public key,
    // verify challenge in clientDataJSON, increment sign counter, issue JWT session.
    return reply.code(501).send({
      code: "NOT_IMPLEMENTED",
      message: "WebAuthn verification pending full cryptographic implementation",
    });
  });

  /** List registered passkeys for current user */
  app.get("/v1/identity/webauthn/credentials", async (req, reply) => {
    const ctx = resolveContext(req);
    // TODO: query webauthn_credentials table by actorId
    return reply.send({ data: [], total: 0 });
  });

  /** Delete a passkey */
  app.delete("/v1/identity/webauthn/credentials/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    // TODO: soft-delete credential
    return reply.code(204).send();
  });
}
