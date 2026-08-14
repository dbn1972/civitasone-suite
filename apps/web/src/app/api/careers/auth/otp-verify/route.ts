import { NextResponse } from "next/server";

const GATEWAY = (process.env.CIVITASONE_API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8080").replace(/\/$/, "");
const TENANT_ID = process.env.DEMO_TENANT_ID ?? process.env.NEXT_PUBLIC_DEMO_TENANT_ID ?? "";
const CAND_COOKIE = "cand_token";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const upstream = await fetch(`${GATEWAY}/api/v1/careers/auth/otp-verify`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-tenant-id": TENANT_ID,
      },
      body: JSON.stringify({ ...body, tenantId: body.tenantId ?? TENANT_ID }),
    });
    if (!upstream.ok) {
      const text = await upstream.text();
      return new NextResponse(text, { status: upstream.status, headers: { "content-type": "application/json" } });
    }
    const data = await upstream.json() as { token: string; candidateId: string; name: string };
    const res = NextResponse.json({ candidateId: data.candidateId, name: data.name }, { status: 200 });
    res.cookies.set(CAND_COOKIE, data.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 7 * 24 * 60 * 60,
    });
    return res;
  } catch {
    return NextResponse.json({ code: "GATEWAY_ERROR", message: "could not reach service" }, { status: 502 });
  }
}
