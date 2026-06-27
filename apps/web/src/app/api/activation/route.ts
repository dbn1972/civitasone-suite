import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { COOKIE } from "@/lib/auth/config";
import { isFunnelStep } from "@/app/_data/activationStore";

/**
 * Activation funnel ingestion — now DURABLE.
 *
 * Forwards the event to analytics-service (via the gateway) using the caller's
 * session token, so the tenant is derived server-side from the JWT and the event
 * is persisted in analytics.fact_events (idempotent earliest-wins). The web never
 * trusts a client-supplied tenant. Instrumentation must never block the UI, so a
 * forwarding failure is swallowed with a 204.
 */
function gatewayBase(): string | null {
  const b = process.env.CIVITASONE_API_BASE_URL || process.env.NEXT_PUBLIC_API_BASE_URL || null;
  return b ? b.replace(/\/$/, "") : null;
}

export async function POST(request: Request) {
  const token = cookies().get(COOKIE.ACCESS)?.value;
  if (!token) return NextResponse.json({ ok: false }, { status: 401 });

  let step: unknown;
  try {
    step = (await request.json())?.step;
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  if (!isFunnelStep(step)) return NextResponse.json({ ok: false }, { status: 400 });

  const base = gatewayBase();
  if (!base) return new NextResponse(null, { status: 204 });

  try {
    await fetch(`${base}/api/v1/analytics/activation/events`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ step }),
      cache: "no-store",
    });
  } catch {
    /* never let instrumentation break the UI */
  }
  return new NextResponse(null, { status: 204 });
}
