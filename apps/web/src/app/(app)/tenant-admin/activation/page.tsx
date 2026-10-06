import { cookies } from "next/headers";
import { PageHeader } from "../../../_components/ds";
import { requireAnyRole, getSessionRoles } from "@/lib/auth/roleGuard";
import { COOKIE } from "@/lib/auth/config";
import { aggregateFunnel, type ActivationEvent } from "@/lib/activation";
import { ActivationView } from "./ActivationView";

export const metadata = { title: "Activation" };

/**
 * Fetch activation events. Platform admins get the cross-office (platform) funnel;
 * everyone else gets their own office's funnel. Returns events + the scope label
 * + a `failed` flag so the UI can tell an outage apart from a brand-new tenant.
 *
 * GAP-TENANT-ADMIN-ACTIVATION-01 (FAILMASK): previously this returned
 * `{ events: [] }` for a missing token, a non-2xx response AND a network
 * error, so an outage rendered "No activation events yet" / 0% — identical to
 * a new tenant. `failed` now distinguishes the two.
 */
async function loadEvents(): Promise<{ events: ActivationEvent[]; platform: boolean; failed: boolean }> {
  const roles = getSessionRoles();
  const platform = roles.some((r) => /platform_admin|super_admin/.test(r));

  const token = cookies().get(COOKIE.ACCESS)?.value;
  const base = (process.env.CIVITASONE_API_BASE_URL || "").replace(/\/$/, "");
  if (!token || !base) return { events: [], platform, failed: true };

  const path = platform
    ? "/api/v1/analytics/activation/funnel/platform"
    : "/api/v1/analytics/activation/funnel";

  try {
    const res = await fetch(`${base}${path}`, {
      headers: { authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!res.ok) return { events: [], platform, failed: true };
    const json = (await res.json()) as {
      tenantId?: string;
      events: { step: string; at: string; tenantId?: string }[];
    };
    const events = (json.events ?? []).map((e) => ({
      tenantId: e.tenantId ?? json.tenantId ?? "self",
      step: e.step as ActivationEvent["step"],
      at: e.at,
    }));
    return { events, platform, failed: false };
  } catch {
    return { events: [], platform, failed: true };
  }
}

/**
 * Activation dashboard — the north-star view. Shows Time-to-First-Real-Transaction
 * (TTFRT) and where offices drop off along the golden path. Admin-only. Reads
 * activation events from analytics-service (one office, or platform-wide for
 * platform admins).
 */
export default async function ActivationPage() {
  requireAnyRole(["admin", "tenant_admin", "platform_admin", "super_admin"]);

  const { events, platform, failed } = await loadEvents();
  const agg = aggregateFunnel(events);

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Activation"
        subtitle={
          platform
            ? "How quickly offices across the platform reach their first real transaction, and where they get stuck."
            : "How quickly your office reached its first real transaction, and where setup stalled."
        }
        help="tenant-admin"
      />
      <ActivationView agg={agg} platform={platform} failed={failed} />
    </div>
  );
}
