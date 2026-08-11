import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { COOKIE } from "@/lib/auth/config";

const GATEWAY = (
  process.env.CIVITASONE_API_BASE_URL ??
  process.env.NEXT_PUBLIC_API_BASE_URL ??
  "http://localhost:8080"
).replace(/\/$/, "");

/**
 * SSE proxy — streams /api/notification/stream to the gateway SSE endpoint.
 * EventSource sends cookies; we extract the JWT and forward as Bearer header.
 * Uses ReadableStream to avoid buffering the SSE response.
 */
export async function GET(req: Request) {
  const token = cookies().get(COOKIE.ACCESS)?.value;
  if (!token) {
    return NextResponse.json({ code: "UNAUTHORIZED" }, { status: 401 });
  }

  const url = new URL(req.url);
  const target = `${GATEWAY}/api/notification/stream${url.search}`;

  const controller = new AbortController();
  req.signal.addEventListener("abort", () => controller.abort());

  const upstream = await fetch(target, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "text/event-stream",
      "Cache-Control": "no-cache",
    },
    signal: controller.signal,
  });

  if (!upstream.ok) {
    return new NextResponse(upstream.body, { status: upstream.status });
  }

  // Stream the SSE response through without buffering
  return new NextResponse(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
