import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { COOKIE } from "@/lib/auth/config";

const GATEWAY = (
  process.env.CIVITASONE_API_BASE_URL ??
  process.env.NEXT_PUBLIC_API_BASE_URL ??
  "http://localhost:8080"
).replace(/\/$/, "");

/**
 * Proxy POST /api/notification/mark-read to notification-service.
 */
export async function POST(req: Request) {
  const token = (await cookies()).get(COOKIE.ACCESS)?.value;
  if (!token) {
    return NextResponse.json({ code: "UNAUTHORIZED" }, { status: 401 });
  }

  const body = await req.text();
  const target = `${GATEWAY}/api/notification/stream/mark-read`;

  let upstream: Response;
  let text: string;
  try {
    upstream = await fetch(target, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body,
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
