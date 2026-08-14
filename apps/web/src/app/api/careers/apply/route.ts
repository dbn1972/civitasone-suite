import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const GATEWAY = (process.env.CIVITASONE_API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8080").replace(/\/$/, "");
const DEFAULT_TENANT_ID = process.env.DEMO_TENANT_ID ?? process.env.NEXT_PUBLIC_DEMO_TENANT_ID ?? "";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = await req.json() as Record<string, unknown>;
    const bodyTenantId = typeof body.tenantId === "string" && UUID_RE.test(body.tenantId)
      ? body.tenantId
      : null;
    const tenantId = bodyTenantId ?? DEFAULT_TENANT_ID;
    const upstream = await fetch(`${GATEWAY}/api/v1/careers/apply`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-tenant-id": tenantId,
      },
      body: JSON.stringify({ ...body, tenantId }),
    });
    const data = await upstream.json() as unknown;
    return NextResponse.json(data, { status: upstream.status });
  } catch (err) {
    return NextResponse.json({ code: "INTERNAL", message: "proxy error" }, { status: 502 });
  }
}
