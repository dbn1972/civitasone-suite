/**
 * POST /api/contact — public contact-enquiry proxy (GAP-CONTACT-HOME-01/02/06).
 *
 * The marketing contact page is static and has no tenant/session context, so the
 * browser cannot call a backend service directly (it has no gateway credentials and
 * CORS is locked down). This route is the thin server-side hop that the careers apply
 * flow also uses: it validates the body again, injects the deployment's PUBLIC
 * lead-capture form key, and forwards to crm-service's unauthenticated capture endpoint
 *   POST {gateway}/api/v1/crm/public/leads/:formKey
 *
 * Honesty / fail-closed:
 *  - If no form key is configured (CONTACT_LEAD_FORM_KEY), there is no backend to accept
 *    the lead, so we return 503 NOT_CONFIGURED and the page falls back to its mailto
 *    channels rather than pretending a submission was stored.
 *  - The reference returned to the prospect is the backend's own `correlationId` — a
 *    real server value — never a client-invented ticket number.
 *
 * No PII is logged here; on failure we return a generic envelope.
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  CONTACT_TOPICS,
  toPublicLeadBody,
  isValidEmail,
  type ContactTopic,
} from "@/app/(marketing)/contact/contactForm";

const GATEWAY = (
  process.env.CIVITASONE_API_BASE_URL ??
  process.env.NEXT_PUBLIC_API_BASE_URL ??
  "http://localhost:8080"
).replace(/\/$/, "");

/** 64-hex public form key, provisioned per deployment (bearer secret in a URL). */
const FORM_KEY = (process.env.CONTACT_LEAD_FORM_KEY ?? "").trim();
const FORM_KEY_RE = /^[0-9a-f]{64}$/;

interface IncomingBody {
  name?: unknown;
  department?: unknown;
  email?: unknown;
  phone?: unknown;
  message?: unknown;
  topic?: unknown;
  consent?: unknown;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!FORM_KEY_RE.test(FORM_KEY)) {
    // No capture backend wired for this deployment — be honest, don't fake success.
    return NextResponse.json(
      {
        code: "NOT_CONFIGURED",
        message:
          "The enquiry form is not available right now. Please email us using the addresses on this page.",
      },
      { status: 503 },
    );
  }

  let body: IncomingBody;
  try {
    body = (await req.json()) as IncomingBody;
  } catch {
    return NextResponse.json({ code: "BAD_REQUEST", message: "invalid request" }, { status: 400 });
  }

  const name = str(body.name).trim();
  const email = str(body.email).trim();
  const topic = str(body.topic) as ContactTopic;
  const consent = body.consent === true;

  // First-line validation; crm re-validates authoritatively.
  if (name === "" || !isValidEmail(email) || !CONTACT_TOPICS.includes(topic) || !consent) {
    return NextResponse.json(
      { code: "VALIDATION_FAILED", message: "Please check the form and try again." },
      { status: 400 },
    );
  }

  const upstreamBody = toPublicLeadBody({
    name,
    email,
    department: str(body.department),
    phone: str(body.phone),
    message: str(body.message),
    topic,
    consent,
  });

  try {
    const upstream = await fetch(`${GATEWAY}/api/v1/crm/public/leads/${FORM_KEY}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(upstreamBody),
    });

    if (!upstream.ok) {
      // Surface rate-limit backpressure so the UI can ask the user to retry.
      if (upstream.status === 429) {
        return NextResponse.json(
          { code: "RATE_LIMITED", message: "Too many submissions — please try again shortly." },
          { status: 429 },
        );
      }
      return NextResponse.json(
        { code: "UPSTREAM_ERROR", message: "We could not submit your enquiry. Please email us instead." },
        { status: 502 },
      );
    }

    const data = (await upstream.json().catch(() => null)) as { correlationId?: unknown } | null;
    const reference = typeof data?.correlationId === "string" ? data.correlationId : null;
    return NextResponse.json({ status: "accepted", reference }, { status: 202 });
  } catch {
    return NextResponse.json(
      { code: "UPSTREAM_ERROR", message: "We could not submit your enquiry. Please email us instead." },
      { status: 502 },
    );
  }
}
