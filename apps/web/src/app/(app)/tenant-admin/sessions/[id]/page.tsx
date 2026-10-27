import { notFound } from "next/navigation";
import { PageHeader, Card, StatusPill, RefreshErrorState } from "@/app/_components/ds";
import { formatIndianDateTime } from "@/lib/formatters";
import { toHumanError } from "@/lib/messages";
import { getSessionById } from "@/app/_data/loaders";
import { getSessionUserId, getSessionRoles } from "@/lib/auth/roleGuard";
import { deviceLabel, networkLabel } from "../sessionHelpers";
import { RevokeButton } from "./RevokeButton";
import { IpReveal } from "./IpReveal";

/**
 * GAP-TENANT-ADMIN-SESSIONS-DETAIL-05: an IP is personal data under DPDP. The
 * detail page is role-gated to tenant/platform/super admins, and there is no
 * audited server-side reveal endpoint for session IPs today, so the SAFEST
 * default is to show only the coarse network and mask the host part rather
 * than print the full address to every admin viewer. Honest, needs no backend.
 */
function maskIp(ip?: string): string {
  if (!ip) return "—";
  // identity-service already masks the IP for admin views (owner decision #21); only mask here if a clear one arrives.
  if (ip.includes("*")) return ip;
  const octets = ip.split(".");
  if (octets.length === 4) return `${octets[0]}.${octets[1]}.•.•`;
  // IPv6 or unexpected shape: show only the first segment.
  const seg = ip.split(":")[0] ?? ip.slice(0, 4);
  return `${seg}:••••`;
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2, padding: "10px 0", borderBottom: "1px solid var(--border)" }}>
      <dt style={{ fontSize: 12, color: "var(--ink2)", fontWeight: 500 }}>{label}</dt>
      <dd style={{ margin: 0, fontSize: 14, fontWeight: 400 }}>{value}</dd>
    </div>
  );
}

export default async function SessionDetailPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const result = await getSessionById(params.id);
  const { data: session, source, status } = result;

  // A real 404 (session not in this tenant / unknown id) is a genuine
  // not-found, not a transient failure — surface Next.js's notFound().
  if (source === "error" && status === 404) notFound();

  if (source === "error") {
    return (
      <div className="page-main wrap">
        <PageHeader back="/tenant-admin/sessions" title="Session Detail" subtitle="Could not load this session." />
        <Card title="Session">
          <RefreshErrorState error={toHumanError("load", { area: "session" })} backHref="/tenant-admin/sessions" />
        </Card>
      </div>
    );
  }

  if (!session) notFound();

  const currentUserId = getSessionUserId();
  const isOwn = currentUserId != null && session.userId === currentUserId;
  const who = session.userName ?? session.userEmail;

  return (
    <div className="page-main wrap">
      <PageHeader
        back="/tenant-admin/sessions"
        title="Session Detail"
        subtitle={`Session for ${who} (${session.userEmail})`}
        actions={
          session.status === "active" && !isOwn
            ? <RevokeButton sessionId={session.id} who={who} />
            : undefined
        }
      />

      <div className="grid g-2" style={{ marginTop: 18 }}>
        <Card title="User & Authentication" padding>
          <dl style={{ margin: 0 }}>
            <Field label="User" value={who} />
            <Field label="Email" value={session.userEmail} />
            <Field label="MFA Verified" value={<StatusPill status={session.mfaVerified ? "verified" : "unconfigured"} label={session.mfaVerified ? "Verified" : "Not verified"} />} />
            <Field
              label="Status"
              value={<StatusPill status={session.status} label={session.status === "active" ? "Active" : session.status === "revoked" ? "Revoked" : "Expired"} />}
            />
            {isOwn ? <Field label="" value={<span className="pill info">This is your current session</span>} /> : null}
          </dl>
        </Card>
        <Card title="Device & Network" padding>
          <dl style={{ margin: 0 }}>
            <Field label="Device" value={deviceLabel(session.userAgent)} />
            <Field label="Network" value={networkLabel(session.ipAddress)} />
            <Field
              label="IP Address"
              value={
                <IpReveal
                  sessionId={session.id}
                  maskedIp={maskIp(session.ipAddress)}
                  // OWNER DECISION #21: only the security admin may reveal the clear IP (audited, with a reason).
                  canReveal={getSessionRoles().includes("security_admin") && session.ipAddress !== undefined}
                />
              }
            />
          </dl>
        </Card>
      </div>
      <Card title="Timing" padding>
        <dl style={{ margin: 0 }}>
          {session.startedAt ? <Field label="Started" value={formatIndianDateTime(session.startedAt)} /> : null}
          <Field label="Last Activity" value={formatIndianDateTime(session.lastActiveAt)} />
          {session.expiresAt ? <Field label="Expires" value={formatIndianDateTime(session.expiresAt)} /> : null}
        </dl>
      </Card>
      {session.userAgent ? (
        <Card title="User Agent" padding>
          <p className="mono" style={{ fontSize: 12, margin: 0, wordBreak: "break-all" }}>{session.userAgent}</p>
        </Card>
      ) : null}
    </div>
  );
}
