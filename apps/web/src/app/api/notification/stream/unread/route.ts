import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { COOKIE } from "@/lib/auth/config";

const GATEWAY = (
  process.env.CIVITASONE_API_BASE_URL ??
  process.env.NEXT_PUBLIC_API_BASE_URL ??
  "http://localhost:8080"
).replace(/\/$/, "");

/**
 * Proxy GET /api/notification/stream/unread to notification-service.
 */
export async function GET(req: Request) {
  const token = (await cookies()).get(COOKIE.ACCESS)?.value;
  if (!token) {
    return NextResponse.json({ code: "UNAUTHORIZED" }, { status: 401 });
  }

  const url = new URL(req.url);
  const target = `${GATEWAY}/api/notification/stream/unread${url.search}`;

  let upstream: Response;
  let text: string;
  try {
    upstream = await fetch(target, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(30_000),
    });
    text = await upstream.text();
  } catch {
    return NextResponse.json({ code: "UPSTREAM_UNAVAILABLE", message: "upstream service unavailable" }, { status: 502 });
  }
  return new NextResponse(text, {
    status: upstream.status,
    headers: { "Content-Type": upstream.headers.get("Content-Type") ?? "application/json" },
  });
}
