import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { formatSharedMetrics } from "@civitasone/observability";

// SEC-029: apps/web (self-hosted via `next start`) has no equivalent to the
// backend services' registerOpsRoutes() (packages/observability) -- there is
// no Fastify app to hang a /metrics route off of, so SEC-027's captureError()
// counter for web-app failures (e.g. a failed session-creation on login --
// see apps/web/src/app/api/auth/callback/route.ts) was real and queryable
// in-process but never actually scraped by Prometheus. This route closes
// that gap by reusing the exact same Prometheus-text formatting every
// backend service already emits (formatSharedMetrics()), so a web-app-
// originated captured error shows up identically to a backend one.
//
// Unlike registerOpsRoutes()'s guard, this route has NO internal-IP
// fallback. Next.js's own request pipeline only backfills x-forwarded-for
// when the header is absent, so any caller can simply supply its own
// "internal-looking" XFF value -- an IP allowlist here would be spoofable,
// which is worse than not exposing the metric at all (it would look safe
// without being safe). METRICS_TOKEN is therefore mandatory: a missing or
// mismatched token fails closed (403), every time, no fallback path.
//
// Force-dynamic: this must never be statically optimized/cached -- every
// scrape needs the current counter values, and Route Handlers otherwise
// default to static when they don't read request-specific Next.js APIs.
export const dynamic = "force-dynamic";

function extractBearerToken(header: string | null): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1]!.trim() : null;
}

/**
 * Constant-time token compare -- avoids leaking METRICS_TOKEN's length or
 * contents through response-time differences. Relies on the default Node.js
 * Route Handler runtime (node:crypto is not available on the edge runtime).
 */
function safeTokenEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    timingSafeEqual(bufA, bufA); // same-cost no-op: a length mismatch must not return faster
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

export async function GET(req: Request) {
  const expected = process.env.METRICS_TOKEN;
  const provided = extractBearerToken(req.headers.get("authorization"));
  if (!expected || !provided || !safeTokenEqual(provided, expected)) {
    return NextResponse.json(
      { code: "FORBIDDEN", message: "metrics access denied" },
      { status: 403 },
    );
  }

  const lines = [
    "# HELP service_up Service process is running",
    "# TYPE service_up gauge",
    'service_up{service="web"} 1',
    ...formatSharedMetrics(),
  ];
  return new NextResponse(lines.join("\n") + "\n", {
    status: 200,
    headers: { "content-type": "text/plain; version=0.0.4" },
  });
}
