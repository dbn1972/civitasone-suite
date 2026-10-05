import { getTranslations } from "next-intl/server";
import { fetchJson } from "../../../../_data/apiClient";
import { PageHeader, StatusPill, Card } from "../../../../_components/ds";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { ServiceRequestActions } from "./ServiceRequestActions";
import { PriorityBadge } from "../PriorityBadge";

/**
 * GAP-CRM-SERVICE-REQUESTS-DETAIL-02 (DPDP): a citizen's phone and email are
 * personal data. They are masked for ordinary desk staff and shown in clear
 * only to a privileged role. The clear value is rendered into the server HTML
 * ONLY for a privileged viewer — an ordinary viewer's response never carries
 * it — so this is a server-side gate, not a client-side hide.
 */
const PII_REVEAL_ROLES = ["crm_admin", "admin", "super_admin", "platform_admin", "tenant_admin"];

function maskPhone(v?: string): string {
  if (!v) return "—";
  const digits = v.replace(/\D/g, "");
  if (digits.length < 4) return "•••";
  return `${digits.slice(0, 2)}••••••${digits.slice(-2)}`;
}

function maskEmail(v?: string): string {
  if (!v) return "—";
  const at = v.indexOf("@");
  if (at <= 0) return "•••";
  const user = v.slice(0, at);
  const domain = v.slice(at + 1);
  const dot = domain.lastIndexOf(".");
  const tld = dot >= 0 ? domain.slice(dot) : "";
  const host = dot >= 0 ? domain.slice(0, dot) : domain;
  const uHead = user.slice(0, 1);
  const dHead = host.slice(0, 1);
  return `${uHead}${"*".repeat(Math.max(2, user.length - 1))}@${dHead}${"*".repeat(Math.max(2, host.length - 1))}${tld}`;
}

interface ServiceRequestDetail {
  id: string;
  referenceNo: string;
  citizenName: string;
  citizenPhone?: string;
  citizenEmail?: string;
  serviceType: string;
  subject: string;
  description?: string;
  priority: string;
  status: string;
  assignedTo?: string;
  resolution?: string;
  statusNote?: string;
  dueAt?: string;
  resolvedAt?: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

function fmt(dt?: string) {
  if (!dt) return "—";
  return new Date(dt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

/**
 * GAP-CRM-SERVICE-REQUESTS-DETAIL-05: a request is overdue when its due date is
 * in the past and it is still workable (not resolved/closed/cancelled).
 */
const WORKABLE = new Set(["open", "in_progress", "pending"]);
function overdueDays(dueAt: string | undefined, status: string): number | null {
  if (!dueAt || !WORKABLE.has(status)) return null;
  const due = new Date(dueAt).getTime();
  if (!Number.isFinite(due) || due >= Date.now()) return null;
  return Math.floor((Date.now() - due) / 86_400_000);
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <dt style={{ fontSize: 12, color: "var(--ink2)" }}>{label}</dt>
      <dd style={{ margin: 0, fontSize: 14, color: "var(--ink)" }}>{children}</dd>
    </div>
  );
}

export default async function ServiceRequestDetailPage({ params }: { params: { id: string } }) {
  const { data: r, source } = await fetchJson<{ data?: ServiceRequestDetail } | ServiceRequestDetail, ServiceRequestDetail | null>(
    `/api/v1/crm/service-requests/${params.id}`,
    null,
    {
      revalidateSeconds: 0,
      telemetryKey: "crm.service-request.detail",
      mapResponse: (p) => {
        if (!p || typeof p !== "object") return null;
        const rec = p as Record<string, unknown>;
        return (rec.data ?? rec) as ServiceRequestDetail;
      },
    },
  );

  const t = await getTranslations("crmServiceRequestDetail");

  if (!r) {
    return (
      <>
        <PageHeader
          title={t("notFoundTitle")}
          subtitle={t("notFoundSubtitle")}
          back="/crm/service-requests"
          backLabel={t("backLabel")}
        />
        {source === "error" && <DataSourceBadge source={source} />}
      </>
    );
  }

  const roles = getSessionRoles();
  const priorityKey = (r.priority ?? "normal").toLowerCase();
  const priorityLabel = ["urgent", "high", "normal", "low"].includes(priorityKey)
    ? t(`priority_${priorityKey}`)
    : undefined;
  const canRevealPii = PII_REVEAL_ROLES.some((role) => roles.includes(role));

  return (
    <>
      <PageHeader
        title={r.referenceNo ?? t("title")}
        subtitle={r.subject}
        back="/crm/service-requests"
        backLabel={t("backLabel")}
        actions={<ServiceRequestActions id={r.id} status={r.status} version={r.version} />}
      />
      {source === "error" && <DataSourceBadge source={source} />}

      <div className="detail-split">
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Card title={t("detailsCard")}>
            <dl
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                gap: 16,
                padding: "4px 0",
                margin: 0,
              }}
            >
              <Field label={t("serviceType")}>{r.serviceType ?? "—"}</Field>
              <Field label={t("priority")}><PriorityBadge priority={r.priority ?? "normal"} label={priorityLabel} /></Field>
              <Field label={t("status")}><StatusPill status={r.status ?? "open"} /></Field>
              <Field label={t("assignedTo")}>
                {r.assignedTo ? (
                  t("assigned")
                ) : (
                  <span style={{ color: "var(--ink2)" }}>{t("unassigned")}</span>
                )}
              </Field>
              <Field label={t("due")}>
                {(() => {
                  const od = overdueDays(r.dueAt, r.status ?? "open");
                  if (od === null) return fmt(r.dueAt);
                  return (
                    <span style={{ display: "inline-flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <span>{fmt(r.dueAt)}</span>
                      <StatusPill
                        status="overdue"
                        label={od === 0 ? t("overdue") : t("overdueBy", { days: od })}
                        variant="bad"
                      />
                    </span>
                  );
                })()}
              </Field>
            </dl>
            {r.description ? (
              <p style={{ marginTop: 16, fontSize: 14, color: "var(--ink)", whiteSpace: "pre-wrap" }}>
                {r.description}
              </p>
            ) : null}
          </Card>

          {/* GAP-CRM-SERVICE-REQUESTS-DETAIL-01: the Resolution card is shown
              ONLY for a genuinely resolved/closed request that has a resolution
              recorded, and the "Resolved <when>" line is hidden when there is no
              resolvedAt (no more "Resolved —"). A pending request's waiting note
              and a Close's remarks live in their own card below, driven by
              statusNote — never mislabelled as a resolution. */}
          {r.resolution && (r.status === "resolved" || r.status === "closed") ? (
            <Card title={t("resolutionCard")}>
              <p style={{ fontSize: 14, color: "var(--ink)", whiteSpace: "pre-wrap", margin: 0 }}>
                {r.resolution}
              </p>
              {r.resolvedAt ? (
                <p style={{ fontSize: 12, color: "var(--ink2)", marginTop: 8, marginBottom: 0 }}>
                  {t("resolvedOn", { when: fmt(r.resolvedAt) })}
                </p>
              ) : null}
            </Card>
          ) : null}

          {r.statusNote ? (
            <Card title={r.status === "pending" ? t("waitingOn") : t("statusNote")}>
              <p style={{ fontSize: 14, color: "var(--ink)", whiteSpace: "pre-wrap", margin: 0 }}>
                {r.statusNote}
              </p>
            </Card>
          ) : null}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Card title={t("citizenCard")}>
            <dl style={{ display: "flex", flexDirection: "column", gap: 12, margin: 0 }}>
              <Field label={t("name")}>{r.citizenName ?? "—"}</Field>
              <Field label={t("phone")}>
                <span style={{ fontFamily: "monospace" }}>
                  {canRevealPii ? (r.citizenPhone ?? "—") : maskPhone(r.citizenPhone)}
                </span>
              </Field>
              <Field label={t("email")}>
                <span style={{ fontFamily: "monospace" }}>
                  {canRevealPii ? (r.citizenEmail ?? "—") : maskEmail(r.citizenEmail)}
                </span>
              </Field>
              {!canRevealPii && (r.citizenPhone || r.citizenEmail) ? (
                <p style={{ fontSize: 12, color: "var(--ink2)", margin: 0 }}>
                  {t("piiMasked")}
                </p>
              ) : null}
            </dl>
          </Card>
          <Card title={t("auditCard")}>
            <dl style={{ display: "flex", flexDirection: "column", gap: 12, margin: 0 }}>
              <Field label={t("logged")}>{fmt(r.createdAt)}</Field>
              <Field label={t("lastUpdated")}>{fmt(r.updatedAt)}</Field>
            </dl>
          </Card>
        </div>
      </div>
    </>
  );
}
