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
  const token = cookies().get(COOKIE.ACCESS)?.value;
  if (!token) {
    return NextResponse.json({ code: "UNAUTHORIZED" }, { status: 401 });
  }

  const url = new URL(req.url);
  const target = `${GATEWAY}/api/notification/stream/unread${url.search}`;

  const upstream = await fetch(target, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });

  const text = await upstream.text();
  return new NextResponse(text, {
    status: upstream.status,
    headers: { "Content-Type": upstream.headers.get("Content-Type") ?? "application/json" },
  });
}
