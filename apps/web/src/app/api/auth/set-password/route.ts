import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GATEWAY = (process.env.CIVITASONE_API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8080").replace(/\/$/, "");

/**
 * First-password step for the single-use set-password link an admin hands to a new user.
 *
 * Public by design (the user has no session yet; the token IS the credential). The browser posts the token and
 * the chosen password here, and this handler forwards them to identity-service through the gateway, which
 * passes the password straight into Keycloak. Nothing is stored, logged or echoed on the way: only the status
 * and the stable error code come back.
 */
function forwardedFor(req: Request): Record<string, string> {
  const xff = req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip");
  return xff ? { "x-forwarded-for": xff.slice(0, 512) } : {};
}

export async function POST(req: Request): Promise<NextResponse> {
  let body: { token?: unknown; password?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ code: "VALIDATION_FAILED", message: "invalid request" }, { status: 400, headers: { "cache-control": "no-store" } });
  }
  if (typeof body.token !== "string" || typeof body.password !== "string") {
    return NextResponse.json({ code: "VALIDATION_FAILED", message: "invalid request" }, { status: 400, headers: { "cache-control": "no-store" } });
  }
  try {
    const res = await fetch(`${GATEWAY}/api/identity/password-setup/redeem`, {
      method: "POST",
      // Pass the client address chain on so the gateway rate-limits the real client, not this server.
      headers: { "content-type": "application/json", ...forwardedFor(req) },
      body: JSON.stringify({ token: body.token, password: body.password }),
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
    const json = (await res.json().catch(() => ({}))) as { code?: unknown; message?: unknown; status?: unknown };
    return NextResponse.json(
      { ...(typeof json.code === "string" ? { code: json.code } : {}), ...(typeof json.message === "string" ? { message: json.message } : {}), ...(typeof json.status === "string" ? { status: json.status } : {}) },
      { status: res.status, headers: { "cache-control": "no-store" } },
    );
  } catch {
    return NextResponse.json({ code: "TEMPORARILY_UNAVAILABLE", message: "could not reach the service; try again shortly" }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
