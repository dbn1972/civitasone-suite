import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Public resume upload for the careers apply form (GAP-RECRUITMENT-CAREERS-DETAIL-04).
 * Accepts the browser's multipart upload, applies the same size / type limits the service enforces (so an
 * oversize or wrong-type file is refused before it is forwarded), and hands the file to the service as base64
 * JSON. The service re-validates everything (declared type, extension, magic bytes, real size), scans it for
 * malware and stores it; this route never keeps the file.
 */
const GATEWAY = (process.env.CIVITASONE_API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8080").replace(/\/$/, "");
const DEFAULT_TENANT_ID = process.env.DEMO_TENANT_ID ?? process.env.NEXT_PUBLIC_DEMO_TENANT_ID ?? "";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MAX_RESUME_BYTES = 5 * 1024 * 1024;
const ALLOWED_RESUME_TYPES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];

/**
 * The client's address for the upstream rate limit: the first hop of the incoming X-Forwarded-For (set by the
 * platform edge in front of Next), else the socket address. The gateway and hrms only believe this header when it
 * arrives from an internal peer, so it cannot be forged by a caller reaching them directly.
 */
function clientIp(req: NextRequest): string {
  const first = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return first || (req as unknown as { ip?: string }).ip || "";
}

const fail = (status: number, code: string, message: string) => NextResponse.json({ code, message }, { status });

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const form = await req.formData();
    const file = form.get("file");
    const jobOpeningId = form.get("jobOpeningId");
    const rawTenant = form.get("tenantId");
    if (!(file instanceof File)) return fail(400, "VALIDATION_FAILED", "a resume file is required");
    if (typeof jobOpeningId !== "string" || !UUID_RE.test(jobOpeningId)) return fail(400, "VALIDATION_FAILED", "jobOpeningId is required");
    if (file.size <= 0) return fail(422, "INVALID_RESUME", "the file is empty");
    if (file.size > MAX_RESUME_BYTES) return fail(413, "INVALID_RESUME", "the file is larger than 5 MB");
    if (!ALLOWED_RESUME_TYPES.includes(file.type)) return fail(422, "INVALID_RESUME", "only PDF, DOC or DOCX files are accepted");
    const tenantId = typeof rawTenant === "string" && UUID_RE.test(rawTenant) ? rawTenant : DEFAULT_TENANT_ID;

    const upstream = await fetch(`${GATEWAY}/api/v1/careers/resume`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-tenant-id": tenantId, ...(clientIp(req) ? { "x-forwarded-for": clientIp(req) } : {}) },
      body: JSON.stringify({
        tenantId, jobOpeningId, fileName: file.name, mimeType: file.type,
        contentBase64: Buffer.from(await file.arrayBuffer()).toString("base64"),
      }),
    });
    const data = (await upstream.json().catch(() => ({ code: "BAD_GATEWAY", message: "unexpected response" }))) as unknown;
    return NextResponse.json(data, { status: upstream.status });
  } catch {
    return fail(502, "INTERNAL", "proxy error");
  }
}
