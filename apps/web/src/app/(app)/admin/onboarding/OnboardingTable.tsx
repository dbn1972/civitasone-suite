"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, ConfirmDialog, DataTable, StatusPill } from "@/app/_components/ds";
import { useSeededResource } from "@/lib/sync/resource";
import { platformExportGuard, revealOnboardingContact } from "@/lib/admin/platformExport";
import {
  STAGE_ACTION_LABEL, createOnboardingRequest, isUuid, moveOnboardingStage, needsReason, nextStages, type CanonicalStage,
} from "@/lib/admin/onboardingActions";
import { AdminRegister } from "../_components/AdminRegister";
import { onboardingStageTone, onboardingStats, provisioningHref, toOnboardingRows, type OnboardingRow } from "./onboardingStats";

type RawRow = Record<string, unknown>;
type Revealed = { name: string; email: string };

const exportGuard = platformExportGuard("onboarding");

export function OnboardingTable({
  queue,
  source = "api",
  errorStatus,
  errorMessage,
  canExport = false,
  canReveal = false,
  canManage = false,
}: {
  queue: RawRow[];
  source?: "api" | "error";
  errorStatus?: number;
  errorMessage?: string;
  /** Platform-operator permission to export the queue (audited, fail-closed). Without it there is no Export button. */
  canExport?: boolean;
  /** Permission to reveal a requester's contact (audited, with a reason). Without it the contact stays masked. */
  canReveal?: boolean;
  /** Create requests and move them between stages (platform_admin / super_admin). Without it the queue is read-only. */
  canManage?: boolean;
}) {
  const { data: raw, provenance, offline, cachedAt } = useSeededResource<RawRow[]>("sa.onboarding", queue, source, (d) => d.length === 0);
  const router = useRouter();
  // A move is accepted (202) before the queue shows it: show the new stage meanwhile, but only while the row is
  // still in the stage it was moved FROM, so a refreshed queue (or another operator) always wins.
  const [moved, setMoved] = useState<Record<string, { from: string; to: string }>>({});
  const rows = useMemo(
    () => toOnboardingRows(raw).map((r) => (moved[r.id] && moved[r.id]!.from === r.stage ? { ...r, stage: moved[r.id]!.to } : r)),
    [raw, moved],
  );
  const [notice, setNotice] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ orgName: "", contactName: "", contactEmail: "", notes: "" });
  const [formBusy, setFormBusy] = useState(false);
  const [formError, setFormError] = useState<string | undefined>(undefined);
  const [moving, setMoving] = useState<{ row: OnboardingRow; to: CanonicalStage } | null>(null);
  const [tenantId, setTenantId] = useState("");
  const [moveBusy, setMoveBusy] = useState(false);
  const [moveError, setMoveError] = useState<string | undefined>(undefined);
  const formValid = form.orgName.trim().length >= 2 && form.contactName.trim().length >= 1 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.contactEmail.trim());

  async function submitCreate() {
    setFormBusy(true); setFormError(undefined);
    const r = await createOnboardingRequest(form);
    setFormBusy(false);
    if (!r.ok) { setFormError(r.message); return; }
    setCreating(false);
    setForm({ orgName: "", contactName: "", contactEmail: "", notes: "" });
    setNotice("Request accepted. It appears in the queue shortly.");
    setTimeout(() => router.refresh(), 1200);
  }

  async function submitMove(note: string | undefined) {
    if (!moving) return;
    setMoveBusy(true); setMoveError(undefined);
    const r = await moveOnboardingStage(moving.row.id, { from: moving.row.stage, to: moving.to, ...(note ? { note } : {}), ...(tenantId ? { provisionedTenantId: tenantId } : {}) });
    setMoveBusy(false);
    if (!r.ok) { setMoveError(r.message); return; }
    setMoved((p) => ({ ...p, [moving.row.id]: { from: moving.row.stage, to: moving.to } }));
    setNotice(`${moving.row.org}: moved to ${moving.to}.`);
    setMoving(null);
    setTimeout(() => router.refresh(), 1200);
  }
  const s = onboardingStats(rows);
  // GAP-ADMIN-ONBOARDING-05: the API returns the contact MASKED; the clear value is held here only after an
  // audited reveal, per request, for this page view. The CSV always carries the masked value.
  const [revealed, setRevealed] = useState<Record<string, Revealed>>({});
  const [revealFor, setRevealFor] = useState<OnboardingRow | null>(null);
  const [revealBusy, setRevealBusy] = useState(false);
  const [revealError, setRevealError] = useState<string | undefined>(undefined);

  async function confirmReveal(reason: string | undefined) {
    if (!revealFor || !reason) return;
    setRevealBusy(true);
    setRevealError(undefined);
    const r = await revealOnboardingContact(revealFor.id, reason);
    setRevealBusy(false);
    if (!r.ok) { setRevealError(r.message); return; }
    setRevealed((prev) => ({ ...prev, [revealFor.id]: { name: r.contactName, email: r.contactEmail } }));
    setRevealFor(null);
  }

  return (
    // GAP-ADMIN-ONBOARDING-02/-03: one data path for cards, badge, failure state and table.
    <AdminRegister
      title="Onboarding Pipeline"
      area="onboarding requests"
      provenance={provenance ?? "live"}
      cachedAt={cachedAt}
      offline={offline}
      errorStatus={errorStatus}
      errorMessage={errorMessage}
      stats={[
        // GAP-ADMIN-ONBOARDING-04: In Queue excludes completed/rejected/cancelled.
        { icon: "📥", iconBg: "#eef2ff", label: "In Queue", value: s.inQueue },
        { icon: "🆕", iconBg: "#ecfdf3", label: "New Requests", value: s.newReqs },
        { icon: "🔄", iconBg: "#fffaeb", label: "In Progress", value: s.inProgress },
        { icon: "🚀", iconBg: "#fce7ee", label: "Ready for Go-Live", value: s.ready },
        { icon: "❔", iconBg: "#f1f5f9", label: "Other stage", value: s.other, onlyWhenPositive: true },
      ]}
    >
      {canManage && (
        <div style={{ marginBottom: 10 }}>
          <Button size="sm" onClick={() => { setFormError(undefined); setNotice(null); setCreating(true); }}>+ New onboarding request</Button>
        </div>
      )}
      {notice && <p role="status" style={{ fontSize: 13, margin: "0 0 10px", color: "var(--mut)" }}>{notice}</p>}
      <DataTable<OnboardingRow>
        columns={[
          { key: "org", label: "Organisation" },
          {
            key: "contact",
            label: "Contact",
            // Export always carries the masked value, whatever has been revealed on screen.
            csv: (r) => r.contact,
            render: (r) => {
              const clear = revealed[r.id];
              if (clear) {
                return (
                  <span>
                    {clear.name} · {clear.email}{" "}
                    <Button variant="ghost" size="sm" aria-label={`Hide contact for ${r.org}`} onClick={() => setRevealed((p) => { const n = { ...p }; delete n[r.id]; return n; })}>Hide</Button>
                  </span>
                );
              }
              return (
                <span>
                  {r.contact || "—"}
                  {canReveal && r.id && r.contact ? (
                    <>{" "}<Button variant="ghost" size="sm" aria-label={`Reveal contact for ${r.org}`} onClick={() => { setRevealError(undefined); setRevealFor(r); }}>Reveal</Button></>
                  ) : null}
                </span>
              );
            },
          },
          { key: "requested", label: "Requested" },
          { key: "assigned", label: "Assigned To" },
          { key: "stage", label: "Stage", render: (r) => <StatusPill status={r.stage} variant={onboardingStageTone(r.stage)} /> },
          {
            key: "id",
            label: "Action",
            csvExclude: true,
            // GAP-ADMIN-ONBOARDING-07: open requests link to provisioning with the request id; closed ones say why not.
            render: (r) => {
              const href = provisioningHref(r);
              const steps = canManage && r.id ? nextStages(r.stage) : [];
              return (
                <span style={{ display: "inline-flex", gap: 4, flexWrap: "wrap", alignItems: "center" }}>
                  {href
                    ? <Link href={href} className="btn ghost sm" aria-label={`Open provisioning for ${r.org}`}>Open provisioning</Link>
                    : <span style={{ color: "var(--mut)", fontSize: 12 }} title="Closed requests cannot be provisioned">{r.id ? "Closed" : "—"}</span>}
                  {steps.map((to) => (
                    <Button key={to} variant="ghost" size="sm" aria-label={`${STAGE_ACTION_LABEL[to]}: ${r.org}`}
                      onClick={() => { setMoveError(undefined); setNotice(null); setTenantId(""); setMoving({ row: r, to }); }}>
                      {STAGE_ACTION_LABEL[to]}
                    </Button>
                  ))}
                </span>
              );
            },
          },
        ]}
        rows={rows} sortable filterable filterPlaceholder="Search onboarding…" pageSize={15}
        exportable={canExport} exportFilename="onboarding-queue" exportGuard={exportGuard}
        emptyIcon="📥" emptyTitle="No requests" emptyMessage="No tenant onboarding requests in queue."
      />
      <ConfirmDialog
        open={creating}
        title="New onboarding request"
        description="Adds a tenant onboarding request to the queue. The contact is personal data: it is stored for the platform team and shown masked."
        confirmLabel="Add request"
        busy={formBusy}
        confirmDisabled={!formValid}
        errorMessage={formError}
        onConfirm={() => void submitCreate()}
        onCancel={() => { if (!formBusy) setCreating(false); }}
      >
        {([["orgName", "Organisation name"], ["contactName", "Contact name"], ["contactEmail", "Contact e-mail"]] as const).map(([k, label]) => (
          <label key={k} style={{ display: "block", fontSize: 13, margin: "8px 0" }}>
            {label}
            <input className="input" style={{ display: "block", width: "100%", marginTop: 4 }} value={form[k]} maxLength={k === "contactEmail" ? 254 : 200}
              type={k === "contactEmail" ? "email" : "text"} onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))} />
          </label>
        ))}
        <label style={{ display: "block", fontSize: 13, margin: "8px 0" }}>
          Notes (optional)
          <textarea className="input" style={{ display: "block", width: "100%", marginTop: 4 }} rows={2} maxLength={2000} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
        </label>
      </ConfirmDialog>
      <ConfirmDialog
        open={moving !== null}
        danger={moving !== null && needsReason(moving.to)}
        requireReason={moving !== null && needsReason(moving.to)}
        optionalReason={moving !== null && !needsReason(moving.to)}
        minReasonLength={3}
        maxReasonLength={500}
        reasonLabel={moving && needsReason(moving.to) ? "Reason" : "Note (optional)"}
        title={moving ? `${STAGE_ACTION_LABEL[moving.to]}: ${moving.row.org}?` : ""}
        description={moving ? `Moves this request from "${moving.row.stage}" to "${moving.to}". If someone else moves it first, this will not apply and you will be told.` : ""}
        confirmLabel={moving ? STAGE_ACTION_LABEL[moving.to] : "Confirm"}
        busy={moveBusy}
        blockConfirm={moving?.to === "completed" && tenantId.trim() !== "" && !isUuid(tenantId)}
        errorMessage={moveError}
        onConfirm={(note) => void submitMove(note)}
        onCancel={() => { if (!moveBusy) setMoving(null); }}
      >
        {moving?.to === "completed" && (
          <label style={{ display: "block", fontSize: 13, margin: "8px 0" }}>
            Provisioned tenant id (optional)
            <input className="input" style={{ display: "block", width: "100%", marginTop: 4 }} value={tenantId} onChange={(e) => setTenantId(e.target.value)} placeholder="UUID of the tenant that was set up" />
            {tenantId.trim() !== "" && !isUuid(tenantId) && <span role="status" style={{ color: "var(--bad)", fontSize: 12 }}>That is not a valid tenant id.</span>}
          </label>
        )}
      </ConfirmDialog>
      <ConfirmDialog
        open={revealFor !== null}
        requireReason
        minReasonLength={3}
        maxReasonLength={500}
        title={revealFor ? `Reveal contact for ${revealFor.org}?` : ""}
        description="The requester's name and e-mail are personal data. Revealing them is recorded in the audit log with your name and the reason you give."
        confirmLabel="Reveal"
        reasonLabel="Reason for viewing"
        busy={revealBusy}
        errorMessage={revealError}
        onConfirm={(reason) => void confirmReveal(reason)}
        onCancel={() => { if (!revealBusy) setRevealFor(null); }}
      />
    </AdminRegister>
  );
}
