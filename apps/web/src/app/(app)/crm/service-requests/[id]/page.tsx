import { formatIndianDateTime } from "@/lib/formatters";
import { getTranslations } from "next-intl/server";
import { fetchJson } from "../../../../_data/apiClient";
import { PageHeader, StatusPill, Card, Masked } from "../../../../_components/ds";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { getSessionRoles, hasAnyRole, CRM_PII_READ_ROLES, CRM_SERVICE_REQUEST_ASSIGN_ROLES } from "@/lib/auth/roleGuard";
import { ServiceRequestActions } from "./ServiceRequestActions";
import { PriorityBadge } from "../PriorityBadge";
import { CaseStatusTimeline, type CaseHistoryEntry } from "../../../../_components/crm/CaseStatusTimeline";

/**
 * GAP-CRM-SERVICE-REQUESTS-DETAIL-02 (DPDP) / F1-04 + F1-06: a citizen's phone
 * and email are personal data. This page asks the server for them MASKED for every
 * viewer (`?maskPii=true`, which can only reduce what crm-service returns -- it
 * already masks for roles outside the CRM PII-read set), then offers a PII-read
 * role the audited reveal: a stated reason is required and crm-service writes the
 * `pii_reveal` audit event before it returns the clear value
 * (POST /v1/crm/pii/reveal). Everyone else sees the masked value and no Reveal
 * button. The page never holds a clear value for anyone.
 */

/**
 * GAP-CRM-SERVICE-REQUESTS-DETAIL-04: what became of the notice to the citizen, as recorded on
 * the request by crm-service. `outcome` null with a channel means the notice is still queued.
 */
interface CitizenNotification {
  channel: "email" | "sms" | null;
  outcome: "sent" | "failed" | "no_template" | "no_contact" | null;
  at: string | null;
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
  assignedTo?: string | null;
  /** Display name of the assignee, resolved server-side (GAP-CRM-SERVICE-REQUESTS-DETAIL-05). */
  assignedToName?: string | null;
  /** GAP-CRM-SERVICE-REQUESTS-NEW-04: the CRM contact this request is linked to, if any. */
  contactId?: string | null;
  contactName?: string | null;
  /** GAP-CRM-SERVICE-REQUESTS-DETAIL-03: who logged / last changed the request (display names). */
  createdByName?: string | null;
  updatedByName?: string | null;
  citizenNotification?: CitizenNotification | null;
  resolution?: string;
  statusNote?: string;
  // GAP-CRM-HEALTH-ACCOUNTID-03: set when the request is an account follow-up
  // (raised from the Account Health screen); null/absent for citizen requests.
  relatedAccountId?: string | null;
  dueAt?: string;
  resolvedAt?: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

function fmt(dt?: string) {
  if (!dt) return "—";
  return formatIndianDateTime(dt);
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
    `/api/v1/crm/service-requests/${params.id}?maskPii=true`,
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
  const canRevealPii = hasAnyRole(roles, CRM_PII_READ_ROLES);
  // GAP-CRM-SERVICE-REQUESTS-DETAIL-05: who may assign / reassign is the shared, server-pinned
  // CRM_SERVICE_REQUEST_ASSIGN_ROLES (roleGuard.ts), not a local copy of the route's list.
  const canAssign = hasAnyRole(roles, CRM_SERVICE_REQUEST_ASSIGN_ROLES);
  const nameUnavailable = t("nameUnavailable");
  const note = r.citizenNotification ?? null;
  const noteChannel = note?.channel ? t(`channel_${note.channel}`) : "";
  let noteText: string | null = null;
  if (note) {
    if (note.outcome === "sent") noteText = t("notifySent", { channel: noteChannel, when: fmt(note.at ?? undefined) });
    else if (note.outcome === "failed") noteText = t("notifyFailed", { channel: noteChannel });
    else if (note.outcome === "no_template") noteText = t("notifyNoTemplate", { channel: noteChannel });
    else if (note.outcome === "no_contact") noteText = t("notifyNoContact");
    else if (note.channel) noteText = t("notifyQueued", { channel: noteChannel });
  }

  // F6-01: status timeline — a separate GET so the detail contract is unchanged.
  const { data: history } = await fetchJson<unknown, CaseHistoryEntry[]>(
    `/api/v1/crm/service-requests/${params.id}/history`,
    [],
    {
      revalidateSeconds: 0,
      telemetryKey: "crm.service-request.history",
      mapResponse: (p) => {
        if (p && typeof p === "object" && Array.isArray((p as { data?: unknown }).data)) {
          return (p as { data: CaseHistoryEntry[] }).data;
        }
        return [];
      },
    },
  );

  return (
    <>
      <PageHeader
        title={r.referenceNo ?? t("title")}
        subtitle={r.subject}
        back="/crm/service-requests"
        backLabel={t("backLabel")}
        actions={
          <ServiceRequestActions
            id={r.id}
            status={r.status}
            version={r.version}
            assignedTo={r.assignedTo ?? null}
            assignedToName={r.assignedToName ?? null}
            canAssign={canAssign}
          />
        }
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
                  // The officer's NAME (resolved server-side); never the raw id. If the name
                  // cannot be resolved, say so rather than print the id.
                  (r.assignedToName ?? t("assignedNameUnavailable"))
                ) : (
                  <span style={{ color: "var(--ink2)" }}>{t("unassigned")}</span>
                )}
              </Field>
              {r.relatedAccountId ? (
                <Field label={t("relatedAccount")}>
                  <a href={`/crm/accounts/${encodeURIComponent(r.relatedAccountId)}`}>{t("viewRelatedAccount")}</a>
                </Field>
              ) : null}
              <Field label={t("due")}>
                {(() => {
                  const od = overdueDays(r.dueAt, r.status ?? "open");
                  // GAP-CRM-SERVICE-REQUESTS-NEW-03: a request with no due date says so, instead of
                  // a bare dash that reads like a load failure.
                  if (!r.dueAt) return <span style={{ color: "var(--ink2)" }}>{t("noDueDate")}</span>;
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

          {/* GAP-CRM-SERVICE-REQUESTS-DETAIL-04: resolving or closing queues a notice to the
              citizen; say what became of it so an officer never assumes a citizen was told. */}
          {noteText ? (
            <Card title={t("notificationCard")}>
              <p
                role={note?.outcome === "failed" || note?.outcome === "no_template" || note?.outcome === "no_contact" ? "alert" : "status"}
                style={{ fontSize: 14, color: "var(--ink)", margin: 0 }}
              >
                {noteText}
              </p>
            </Card>
          ) : null}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Card title={t("citizenCard")}>
            <dl style={{ display: "flex", flexDirection: "column", gap: 12, margin: 0 }}>
              <Field label={t("name")}>{r.citizenName ?? "—"}</Field>
              <Field label={t("phone")}>
                <Masked
                  kind="phone"
                  value={r.citizenPhone}
                  fallback="—"
                  ariaLabel={t("maskedAriaLabel", { label: t("revealPhoneLabel") })}
                  onReveal={{
                    canReveal: canRevealPii,
                    resourceType: "service_request",
                    resourceId: r.id,
                    field: "citizenPhone",
                    label: t("revealPhoneLabel"),
                  }}
                />
              </Field>
              <Field label={t("email")}>
                <Masked
                  kind="email"
                  value={r.citizenEmail}
                  fallback="—"
                  ariaLabel={t("maskedAriaLabel", { label: t("revealEmailLabel") })}
                  onReveal={{
                    canReveal: canRevealPii,
                    resourceType: "service_request",
                    resourceId: r.id,
                    field: "citizenEmail",
                    label: t("revealEmailLabel"),
                  }}
                />
              </Field>
              {/* GAP-CRM-SERVICE-REQUESTS-NEW-04: the CRM contact this request was linked to at
                  intake, so a repeat caller is traceable to their record. */}
              {r.contactId ? (
                <Field label={t("linkedContact")}>
                  <a href={`/crm/contacts/${encodeURIComponent(r.contactId)}`}>
                    {r.contactName ?? t("contactNameUnavailable")}
                  </a>
                </Field>
              ) : null}
              {r.citizenPhone || r.citizenEmail ? (
                <p style={{ fontSize: 12, color: "var(--ink2)", margin: 0 }}>
                  {canRevealPii ? t("piiRevealNote") : t("piiMasked")}
                </p>
              ) : null}
            </dl>
          </Card>
          <Card title={t("auditCard")}>
            <dl style={{ display: "flex", flexDirection: "column", gap: 12, margin: 0 }}>
              <Field label={t("logged")}>{fmt(r.createdAt)}</Field>
              <Field label={t("loggedBy")}>{r.createdByName ?? nameUnavailable}</Field>
              <Field label={t("lastUpdated")}>{fmt(r.updatedAt)}</Field>
              <Field label={t("lastUpdatedBy")}>{r.updatedByName ?? nameUnavailable}</Field>
            </dl>
          </Card>
          {/* F6-01: status transition timeline. */}
          <CaseStatusTimeline entries={history} />
        </div>
      </div>
    </>
  );
}
