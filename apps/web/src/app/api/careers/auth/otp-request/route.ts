import { NextResponse } from "next/server";
import { devOtpEchoAllowed, stripDevCode } from "./devCode";

const GATEWAY = (process.env.CIVITASONE_API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8080").replace(/\/$/, "");
const TENANT_ID = process.env.DEMO_TENANT_ID ?? process.env.NEXT_PUBLIC_DEMO_TENANT_ID ?? "";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: Request) {
  try {
    const body = await req.json() as Record<string, unknown>;
    // V4-A-06: one validated tenant drives both the header and the body.
    if (body.tenantId !== undefined && body.tenantId !== null && !(typeof body.tenantId === "string" && UUID_RE.test(body.tenantId))) {
      return NextResponse.json({ code: "BAD_REQUEST", message: "Invalid tenantId" }, { status: 400 });
    }
    const tenantId = typeof body.tenantId === "string" ? body.tenantId : TENANT_ID;
    const upstream = await fetch(`${GATEWAY}/api/v1/careers/auth/otp-request`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-tenant-id": tenantId,
      },
      body: JSON.stringify({ ...body, tenantId }),
    });
    const text = stripDevCode(await upstream.text(), devOtpEchoAllowed());
    return new NextResponse(text, {
      status: upstream.status,
      headers: { "content-type": "application/json" },
    });
  } catch {
    return NextResponse.json({ code: "GATEWAY_ERROR", message: "could not reach service" }, { status: 502 });
  }
}
