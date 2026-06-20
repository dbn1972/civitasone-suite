import type { FastifyRequest } from "fastify";
import { verifyToken, toRequestContext } from "./index.js";
import type { RequestContext } from "@civitasone/types";

/** Thrown when route context cannot be resolved (map to service HttpError). */
export class AuthContextError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string
  ) {
    super(message);
  }
}

/**
 * Resolve RequestContext for route handlers.
 * Prefers req.ctx set by authPlugin (Keycloak RS256). Falls back to HS256 test tokens.
 */
export function resolveServiceContext(req: FastifyRequest): RequestContext {
  const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
  const ctx = (req as FastifyRequest & { ctx?: RequestContext }).ctx;

  if (ctx && ctx.actorId !== "system" && ctx.actorId !== "anonymous") {
    return { ...ctx, correlationId };
  }

  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) {
    throw new AuthContextError(401, "UNAUTHENTICATED", "missing bearer token");
  }

  const useHs256 =
    process.env.JWT_ALGORITHM === "HS256" ||
    process.env.NODE_ENV === "test" ||
    Boolean(process.env.JWT_SECRET);

  if (useHs256 && process.env.JWT_SECRET) {
    try {
      const payload = verifyToken(auth.slice(7), process.env.JWT_SECRET);
      return toRequestContext(payload, correlationId);
    } catch {
      throw new AuthContextError(401, "UNAUTHENTICATED", "invalid or expired token");
    }
  }

  throw new AuthContextError(401, "UNAUTHENTICATED", "invalid or expired token");
}
