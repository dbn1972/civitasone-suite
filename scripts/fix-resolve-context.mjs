#!/usr/bin/env node
/**
 * Patch all service shared/context.ts files to use @civitasone/auth/context resolveServiceContext.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const SERVICES = join(ROOT, "services");

const CONTEXT_TEMPLATE = `import type { FastifyRequest } from "fastify";
import { resolveServiceContext, AuthContextError } from "@civitasone/auth/context";
import { hasAnyRole } from "@civitasone/auth";
import type { RequestContext } from "@civitasone/types";

export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

export function resolveContext(req: FastifyRequest): RequestContext {
  try {
    return resolveServiceContext(req);
  } catch (err) {
    if (err instanceof AuthContextError) {
      throw new HttpError(err.status, err.code, err.message);
    }
    throw err;
  }
}

export function requireRole(ctx: RequestContext, roles: string[]): void {
  if (!hasAnyRole(ctx, roles)) {
    throw new HttpError(403, "FORBIDDEN", \`requires one of: \${roles.join(", ")}\`);
  }
}
`;

let updated = 0;
for (const name of readdirSync(SERVICES)) {
  const ctxPath = join(SERVICES, name, "src", "shared", "context.ts");
  try {
    if (!statSync(ctxPath).isFile()) continue;
    const existing = readFileSync(ctxPath, "utf8");
    if (existing.includes("resolveServiceContext")) continue;
    // Preserve service-specific extras (e.g. resolvePublicContext in citizen-service)
    let extra = "";
    if (existing.includes("resolvePublicContext")) {
      const match = existing.match(/export function resolvePublicContext[\s\S]*?^}/m);
      if (match) extra = "\n" + match[0] + "\n";
    }
    writeFileSync(ctxPath, CONTEXT_TEMPLATE + extra, "utf8");
    updated++;
    console.log("updated", ctxPath);
  } catch {
    /* skip */
  }
}
console.log(`Done. Updated ${updated} context.ts files.`);
