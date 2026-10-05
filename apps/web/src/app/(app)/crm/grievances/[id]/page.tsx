import { getTranslations } from "next-intl/server";
import { fetchJson } from "../../../../_data/apiClient";
import { PageHeader, StatusPill, Card, Masked, LoadErrorState, EmptyState } from "../../../../_components/ds";
import { getSessionRoles, hasAnyRole, CRM_GRIEVANCE_CLOSE_ROLES, CRM_PII_READ_ROLES } from "@/lib/auth/roleGuard";
import { GrievanceActions } from "./GrievanceActions";

interface GrievanceDetail {
  id: string;
  referenceNo: string;
  citizenName: string;
  citizenPhone?: string;
  citizenEmail?: string;
  category: string;
  subject: string;
  description?: string;
  priority: string;
  status: string;
  assignedTo?: string;
  resolution?: string;
  dueAt?: string;
  resolvedAt?: string;
  closedAt?: string;
  escalatedAt?: string;
  // GAP-CRM-GRIEVANCES-DETAIL-04: the GET /:id endpoint
  // (crm-service modules/grievances/routes.ts) returns these for a grievance
  // that has been forwarded or appealed; shown only when present.
  forwardedTo?: string;
  forwardedAt?: string;
  appealReason?: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

function fmt(dt?: string) {
  if (!dt) return "—";
  return new Date(dt).toLocaleString("en-IN", {
    dateStyle: "medium", timeStyle: "short",
  });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GAP-CRM-GRIEVANCES-DETAIL-08: assignedTo is an identity-service user id
 * (crm.grievances.assigned_to is a UUID), not a person's name. Show a name when
 * resolved, else a short "Assigned (ID …)" label rather than a raw UUID.
 */
function formatAssignee(t: (key: string, values?: Record<string, string>) => string, assignedTo?: string, assigneeName?: string | null): string {
  if (!assignedTo) return t("unassigned");
  if (assigneeName) return assigneeName;
  if (UUID_RE.test(assignedTo)) return t("assignedId", { id: assignedTo.slice(0, 8) });
  return assignedTo;
}

/**
 * GAP-CRM-GRIEVANCES-DETAIL-08: resolve `assignedTo` to a display name through
 * the identity users endpoint. If identity refuses (403 for a non-admin) or
 * fails, fall back to the short label rather than printing a raw UUID.
 */
async function resolveAssigneeName(assignedTo?: string): Promise<string | null> {
  if (!assignedTo || !UUID_RE.test(assignedTo)) return null;
  const res = await fetchJson<unknown, string | null>(`/api/identity/users/${assignedTo}`, null, {
    revalidateSeconds: 300,
    telemetryKey: "crm.grievance.assignee",
    mapResponse: (p) => {
      const r = (p && typeof p === "object" && "data" in (p as object) ? (p as { data: unknown }).data : p) as
        | Record<string, unknown>
        | null;
      if (!r || typeof r !== "object") return null;
      for (const k of ["name", "displayName", "fullName", "email"]) {
        const v = r[k];
        if (typeof v === "string" && v.trim()) return v.trim();
      }
      return null;
    },
  });
  return res.source === "api" && typeof res.data === "string" ? res.data : null;
}

function PriorityBadge({ priority, label }: { priority: string; label: string }) {
  const color =
    priority === "urgent" ? "var(--bad)"
    : priority === "high" ? "var(--warn)"
    : "var(--ink2)";
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 4,
        fontSize: 12,
        fontWeight: 600,
        color: "var(--bg)",
        background: color,
      }}
    >
      {label}
    </span>
  );
}

function TimelineItem({
  ts, label, done,
}: {
  ts?: string; label: string; done: boolean;
}) {
  return (
    <li
      style={{
        display: "flex",
        gap: 12,
        alignItems: "flex-start",
        paddingBottom: 16,
        opacity: done ? 1 : 0.4,
      }}
    >
      <div
        aria-hidden="true"
        style={{
          width: 20,
          height: 20,
          borderRadius: "50%",
          flexShrink: 0,
          marginTop: 2,
          background: done ? "var(--good)" : "var(--line)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 11,
          color: "var(--bg)",
          fontWeight: 700,
        }}
      >
        {done ? "✓" : "○"}
      </div>
      <div>
        <div style={{ fontWeight: 600, fontSize: 14, color: "var(--ink)" }}>{label}</div>
        {ts && <div style={{ fontSize: 12, color: "var(--ink2)", marginTop: 2 }}>{fmt(ts)}</div>}
      </div>
    </li>
  );
}

export default async function GrievanceDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const t = await getTranslations("crmGrievanceDetail");
  const result = await fetchJson<unknown, GrievanceDetail | null>(
    `/api/v1/crm/grievances/${params.id}`,
    null,
    { revalidateSeconds: 0, telemetryKey: "crm.grievance.detail",
      mapResponse: (p) => {
        if (p && typeof p === "object" && "data" in (p as object)) {
          return (p as { data: GrievanceDetail }).data;
        }
        return null;
      },
    },
  );
  const g = result.data;
  const source = result.source;
  const assigneeName = await resolveAssigneeName(g?.assignedTo);

  const roles = getSessionRoles();
  // GAP-CRM-GRIEVANCES-DETAIL-02: the server decides whether to offer Close.
  const canClose = hasAnyRole(roles, CRM_GRIEVANCE_CLOSE_ROLES);
  // GAP-CRM-GRIEVANCES-DETAIL-05: only privileged roles see citizen contact in
  // the clear; everyone else sees a masked value.
  const canRevealPii = hasAnyRole(roles, CRM_PII_READ_ROLES);

  // GAP-CRM-GRIEVANCES-DETAIL-07: a failed load is not a missing record. Only a
  // real 404 (or a successfully-loaded empty body) is "not found"; every other
  // failure (network, 5xx, 403) gets the status-aware retry/permission state so
  // an outage is never titled as a deleted grievance.
  if (!g && source === "error" && result.status !== 404) {
    return (
      <>
        <PageHeader title={t("title")} back="/crm/grievances" backLabel={t("backLabel")} />
        <LoadErrorState result={result} area="grievance" backHref="/crm/grievances" />
      </>
    );
  }

  if (!g) {
    return (
      <>
        <PageHeader title={t("notFoundTitle")} back="/crm/grievances" backLabel={t("backLabel")} />
        <Card>
          <EmptyState
            icon="📭"
            title={t("notFoundTitle")}
            message={t("notFoundMessage")}
            action={<a className="btn" href="/crm/grievances">{t("backToGrievances")}</a>}
          />
        </Card>
      </>
    );
  }

  const priorityLabel = ["urgent", "high", "normal", "low"].includes(g.priority)
    ? t(`priority_${g.priority}`)
    : g.priority.charAt(0).toUpperCase() + g.priority.slice(1);

  const timelineSteps = [
    { label: t("stepLogged"),      ts: g.createdAt,   done: true },
    { label: t("stepAssigned"),    ts: undefined,     done: !!g.assignedTo },
    // GAP-CRM-GRIEVANCES-DETAIL-04: FORWARDED is a real CPGRAMS status, so the
    // timeline now has a Forwarded step with its own forwardedAt time; it is
    // done once the grievance has been forwarded (forwardedTo set) or has moved
    // past REGISTERED/FORWARDED.
    { label: t("stepForwarded"),   ts: g.forwardedAt, done: !!g.forwardedTo || g.status === "FORWARDED" },
    // Renamed from "Escalated" to match the First Appeal action and CPGRAMS
    // portal terminology; still driven by escalatedAt.
    { label: t("stepFirstAppeal"), ts: g.escalatedAt, done: !!g.escalatedAt },
    { label: t("stepResolved"),    ts: g.resolvedAt,  done: !!g.resolvedAt },
    { label: t("stepClosed"),      ts: g.closedAt,    done: !!g.closedAt },
  ];

  return (
    <>
      <PageHeader
        title={g.referenceNo ?? t("title")}
        subtitle={g.subject}
        back="/crm/grievances"
        backLabel={t("backLabel")}
        actions={<GrievanceActions id={g.id} status={g.status} version={g.version} canClose={canClose} />}
      />

      <div className="detail-split">
        {/* Main column */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Card title={t("detailsCard")}>
            <dl
              style={{
                display: "grid",
                gridTemplateColumns: "140px 1fr",
                gap: "10px 16px",
                fontSize: 14,
                margin: "12px 16px",
              }}
            >
              <dt style={{ color: "var(--ink2)" }}>{t("reference")}</dt>
              <dd><code style={{ fontSize: 13 }}>{g.referenceNo ?? "—"}</code></dd>
              <dt style={{ color: "var(--ink2)" }}>{t("category")}</dt>
              <dd>{g.category}</dd>
              <dt style={{ color: "var(--ink2)" }}>{t("priority")}</dt>
              <dd><PriorityBadge priority={g.priority} label={priorityLabel} /></dd>
              <dt style={{ color: "var(--ink2)" }}>{t("status")}</dt>
              <dd><StatusPill status={g.status} /></dd>
              <dt style={{ color: "var(--ink2)" }}>{t("assignedTo")}</dt>
              <dd>{formatAssignee(t, g.assignedTo, assigneeName)}</dd>
              <dt style={{ color: "var(--ink2)" }}>{t("dueBy")}</dt>
              <dd>{fmt(g.dueAt)}</dd>
              {/* GAP-CRM-GRIEVANCES-DETAIL-04: show the department a grievance
                  was forwarded to, only once the backend returns it. */}
              {g.forwardedTo && (
                <>
                  <dt style={{ color: "var(--ink2)" }}>{t("forwardedTo")}</dt>
                  <dd>{g.forwardedTo}{g.forwardedAt ? ` · ${fmt(g.forwardedAt)}` : ""}</dd>
                </>
              )}
              <dt style={{ color: "var(--ink2)" }}>{t("logged")}</dt>
              <dd>{fmt(g.createdAt)}</dd>
              <dt style={{ color: "var(--ink2)" }}>{t("lastUpdated")}</dt>
              <dd>{fmt(g.updatedAt)}</dd>
            </dl>
          </Card>

          {g.description && (
            <Card title={t("descriptionCard")}>
              <p
                style={{
                  margin: "12px 16px",
                  fontSize: 14,
                  color: "var(--ink)",
                  lineHeight: 1.6,
                  whiteSpace: "pre-wrap",
                }}
              >
                {g.description}
              </p>
            </Card>
          )}

          {g.resolution && (
            <Card title={t("resolutionCard")}>
              <p
                style={{
                  margin: "12px 16px",
                  fontSize: 14,
                  color: "var(--ink)",
                  lineHeight: 1.6,
                  whiteSpace: "pre-wrap",
                }}
              >
                {g.resolution}
              </p>
            </Card>
          )}

          {/* GAP-CRM-GRIEVANCES-DETAIL-04: the citizen's reason for a first
              appeal was captured by the action but never displayed. */}
          {g.appealReason && (
            <Card title={t("appealReasonCard")}>
              <p
                style={{
                  margin: "12px 16px",
                  fontSize: 14,
                  color: "var(--ink)",
                  lineHeight: 1.6,
                  whiteSpace: "pre-wrap",
                }}
              >
                {g.appealReason}
              </p>
            </Card>
          )}
        </div>

        {/* Sidebar */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Card title={t("citizenCard")}>
            <dl
              style={{
                display: "grid",
                gridTemplateColumns: "80px 1fr",
                gap: "8px 12px",
                fontSize: 14,
                margin: "12px 16px",
              }}
            >
              <dt style={{ color: "var(--ink2)" }}>{t("name")}</dt>
              <dd style={{ fontWeight: 600 }}>{g.citizenName}</dd>
              <dt style={{ color: "var(--ink2)" }}>{t("phone")}</dt>
              <dd>
                {g.citizenPhone
                  ? canRevealPii
                    ? g.citizenPhone
                    : <Masked value={g.citizenPhone} kind="phone" ariaLabel={t("maskedPhone")} />
                  : "—"}
              </dd>
              <dt style={{ color: "var(--ink2)" }}>{t("email")}</dt>
              <dd style={{ wordBreak: "break-all" }}>
                {g.citizenEmail
                  ? canRevealPii
                    ? g.citizenEmail
                    : <Masked value={g.citizenEmail} kind="email" ariaLabel={t("maskedEmail")} />
                  : "—"}
              </dd>
            </dl>
            {/* GAP-CRM-GRIEVANCES-DETAIL-05: DPDP — citizen contact is personal
                data. It is shown in clear only to a CRM PII-read role; everyone
                else sees a masked value. */}
            {(g.citizenPhone || g.citizenEmail) && !canRevealPii && (
              <p style={{ margin: "0 16px 12px", fontSize: 11, color: "var(--ink2)", lineHeight: 1.5 }}>
                {t("maskedNotice")}
              </p>
            )}
          </Card>

          <Card title={t("timelineCard")}>
            <ol
              style={{ listStyle: "none", padding: "12px 16px", margin: 0 }}
              aria-label={t("timelineAriaLabel")}
            >
              {timelineSteps.map((s) => (
                <TimelineItem key={s.label} {...s} />
              ))}
            </ol>
          </Card>
        </div>
      </div>
    </>
  );
}
