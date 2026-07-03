import type { FastifyInstance } from "fastify";

export interface SecurityHeadersConfig {
  /** Override HSTS max-age (seconds). Default: 31536000 (1 year) */
  hstsMaxAge?: number;
  /** Whether to include subdomains in HSTS. Default: true */
  hstsIncludeSubDomains?: boolean;
  /** Override Cache-Control header. Default: "no-store" */
  cacheControl?: string;
  /** Additional custom headers to set */
  customHeaders?: Record<string, string>;
}

export async function registerSecurityHeaders(
  app: FastifyInstance,
  config: SecurityHeadersConfig = {},
): Promise<void> {
  const hstsMaxAge = config.hstsMaxAge ?? 31536000;
  const hstsSubDomains = config.hstsIncludeSubDomains ?? true;
  const cacheControl = config.cacheControl ?? "no-store";

  app.addHook("onSend", async (_req, reply) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("X-Frame-Options", "DENY");
    reply.header("X-XSS-Protection", "0"); // modern browsers don't need this, but set explicitly
    reply.header(
      "Strict-Transport-Security",
      `max-age=${hstsMaxAge}${hstsSubDomains ? "; includeSubDomains" : ""}`,
    );
    reply.header("Referrer-Policy", "strict-origin-when-cross-origin");
    reply.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    reply.header("Cache-Control", cacheControl);

    // Apply any custom headers
    if (config.customHeaders) {
      for (const [key, value] of Object.entries(config.customHeaders)) {
        reply.header(key, value);
      }
    }
  });
}
