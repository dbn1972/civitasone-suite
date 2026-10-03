import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { COOKIE } from "@/lib/auth/config";

const GATEWAY = (process.env.CIVITASONE_API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8080").replace(/\/$/, "");

const FORWARD = ["content-type", "accept", "x-correlation-id", "x-device-id", "x-device-trust-token", "x-step-up-token", "x-idempotency-key"];

export async function GET(req: Request, ctx: { params: { path: string[] } }) {
  return proxy(req, ctx.params.path, "GET");
}

export async function POST(req: Request, ctx: { params: { path: string[] } }) {
  return proxy(req, ctx.params.path, "POST");
}

export async function PATCH(req: Request, ctx: { params: { path: string[] } }) {
  return proxy(req, ctx.params.path, "PATCH");
}

export async function PUT(req: Request, ctx: { params: { path: string[] } }) {
  return proxy(req, ctx.params.path, "PUT");
}

export async function DELETE(req: Request, ctx: { params: { path: string[] } }) {
  return proxy(req, ctx.params.path, "DELETE");
}

// Response headers safe to pass back to the browser (download metadata only).
const FORWARD_RESPONSE = [
  "content-disposition",
  "x-bank-file-signed",
  // GAP-PAYROLL-DISBURSEMENT-03: what the server did with the file, and the id
  // needed to fetch its detached signature.
  "x-bank-file-signature-format",
  "x-bank-file-sha256",
  "x-bank-file-encrypted",
  "x-bank-file-issuance-id",
];

// Status codes that must not carry a body (undici constraint)
const NO_BODY_STATUSES = new Set([204, 205, 304]);

async function proxy(req: Request, segments: string[], method: string) {
  // M1: block path-traversal segments
  if (segments.some(s => decodeURIComponent(s) === '..' || decodeURIComponent(s) === '.')) {
    return NextResponse.json({ code: 'BAD_REQUEST', message: 'Invalid path' }, { status: 400 });
  }
  const token = cookies().get(COOKIE.ACCESS)?.value;
  if (!token) return NextResponse.json({ code: "UNAUTHORIZED" }, { status: 401 });

  const subpath = segments.join("/");
  const url = new URL(req.url);
  const target = `${GATEWAY}/api/${subpath}${url.search}`;

  const headers: Record<string, string> = { authorization: `Bearer ${token}` };
  for (const h of FORWARD) {
    const v = req.headers.get(h);
    if (v) headers[h] = v;
  }

  const hasBody = method !== "GET" && method !== "HEAD";
  const body = hasBody ? await req.text() : undefined;

  const upstream = await fetch(target, { method, headers, body });
  if (NO_BODY_STATUSES.has(upstream.status)) {
    return new NextResponse(null, { status: upstream.status });
  }
  // GAP-PAYROLL-DISBURSEMENT-02/03: file downloads (bank files) need the
  // body passed through byte-for-byte -- `upstream.text()` UTF-8-decoded a
  // NACH multi-file ZIP and corrupted it -- and need their filename and
  // signed-status headers, which were dropped here.
  const responseBody = await upstream.arrayBuffer();
  const responseHeaders: Record<string, string> = {
    "content-type": upstream.headers.get("content-type") ?? "application/json",
  };
  for (const h of FORWARD_RESPONSE) {
    const v = upstream.headers.get(h);
    if (v) responseHeaders[h] = v;
  }
  return new NextResponse(responseBody, { status: upstream.status, headers: responseHeaders });
}
