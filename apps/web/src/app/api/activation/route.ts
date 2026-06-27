import { NextResponse } from "next/server";
import { getSessionTenantId, getSessionRoles } from "@/lib/auth/roleGuard";
import { recordActivationEvent, getActivationEvents, isFunnelStep } from "@/app/_data/activationStore";
import { aggregateFunnel } from "@/lib/activation";

/**
 * Activation funnel ingestion + read.
 *
 * POST records one funnel event for the CURRENT office. The tenant id is taken
 * from the session, never from the request body, so events are always correctly
 * tenant-scoped and a client cannot spoof another office (Requirement 13.4 spirit).
 *
 * GET returns the aggregate funnel + TTFRT for the internal activation view.
 */
export async function POST(request: Request) {
  const tenantId = getSessionTenantId();
  if (!tenantId) return NextResponse.json({ ok: false }, { status: 401 });

  let step: unknown;
  try {
    const body = await request.json();
    step = body?.step;
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  if (!isFunnelStep(step)) return NextResponse.json({ ok: false }, { status: 400 });

  recordActivationEvent(tenantId, step);
  return NextResponse.json({ ok: true });
}

export function GET() {
  // Aggregates are an admin/operator view; gate to admin-ish roles.
  const roles = getSessionRoles();
  const allowed = roles.some((r) => /admin|super|platform|operator/i.test(r));
  if (!allowed) return NextResponse.json({ ok: false }, { status: 403 });

  return NextResponse.json(aggregateFunnel(getActivationEvents()));
}
