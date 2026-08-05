"use client";
/**
 * CampaignList — MK-001. Lists marketing campaigns (name, objective, status,
 * budget, ROI) and hosts an inline "New campaign" dialog. Every ROI/count is
 * gated on source === "error": a failed list fetch renders "—" + the saved-info
 * badge, never a fabricated "0 campaigns" / "ROI 0%" as fact. A campaign whose
 * ROI is not yet computed (roiBps null) shows "—", never "0%".
 *
 * Budget is entered as a rupee decimal and converted to a paise integer STRING
 * with rupeesToMinorString (no float); it is displayed with formatMoney.
 */
import { useEffect, useId, useMemo, useState } from "react";
import Link from "next/link";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { EmptyState } from "@/app/_components/ds";
import { StatusBadge } from "../../_components/StatusBadge";
import { formatMoney } from "@/lib/formatters";
import { rupeesToMinorString } from "@/lib/money";
import {
  getCampaigns,
  getCampaignTemplates,
  getCampaignSegments,
  createCampaign,
  campaignStatusLabel,
  type Campaign,
  type CampaignTemplate,
  type CampaignSegment,
  type Source,
} from "@/lib/notifications/campaigns";

const inputStyle = { padding: 8, minHeight: 38, borderRadius: 8, border: "1px solid var(--line)", width: "100%" } as const;

type ListSource = Source | "loading";

/** Campaigns carry a per-row ROI only after a metrics load; the list contract
 * does not include ROI, so the list shows a link to the detail metrics. */
export function CampaignList() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [listSource, setListSource] = useState<ListSource>("loading");

  const [open, setOpen] = useState(false);

  async function load(isLive: () => boolean = () => true) {
    setListSource("loading");
    const { data, source } = await getCampaigns();
    if (!isLive()) return;
    setCampaigns(data);
    setListSource(source);
  }

  useEffect(() => {
    let live = true;
    void load(() => live);
    return () => {
      live = false;
    };
  }, []);

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div className="card">
        <div className="card-h">
          <h3>Campaigns</h3>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {listSource === "error" ? <DataSourceBadge source="error" /> : null}
            <button type="button" className="btn primary sm" onClick={() => setOpen(true)}>
              New campaign
            </button>
          </div>
        </div>

        {listSource === "loading" ? (
          <p role="status" aria-live="polite" style={{ fontSize: 13, color: "var(--muted)", padding: "0 12px" }}>
            Loading campaigns…
          </p>
        ) : listSource === "error" ? (
          <EmptyState icon="📣" title="—" message="Campaigns could not be loaded. Showing saved information." />
        ) : campaigns.length === 0 ? (
          <EmptyState
            icon="📣"
            title="No campaigns yet"
            message="Create a campaign to reach an audience segment and track its ROI."
          />
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Name</th>
                <th>Objective</th>
                <th>Status</th>
                <th className="num">Budget</th>
                <th>ROI</th>
                <th>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((c) => (
                <tr key={c.id}>
                  <td>
                    <Link href={`/notifications/campaigns/${c.id}`}>{c.name || "(untitled)"}</Link>
                  </td>
                  <td>{c.objective ?? "—"}</td>
                  <td>
                    <StatusBadge status={c.status} label={campaignStatusLabel(c.status)} />
                  </td>
                  <td className="num">{c.budgetMinor !== undefined ? formatMoney(c.budgetMinor) : "—"}</td>
                  <td>
                    <Link href={`/notifications/campaigns/${c.id}`} className="mut">
                      View metrics
                    </Link>
                  </td>
                  <td>
                    <Link className="btn ghost sm" href={`/notifications/campaigns/${c.id}`}>
                      Open
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <CreateCampaignDialog
        open={open}
        onClose={() => setOpen(false)}
        onCreated={() => {
          setOpen(false);
          void load();
        }}
      />
    </div>
  );
}

/* ---------------------------------------------------------- create dialog -- */

function CreateCampaignDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const nameId = useId();
  const templateId = useId();
  const recipientsId = useId();
  const objectiveId = useId();
  const budgetId = useId();
  const segmentId = useId();
  const scheduledId = useId();
  const budgetErrId = useId();
  const nameErrId = useId();
  const templateErrId = useId();
  const recipientsHintId = useId();

  const [name, setName] = useState("");
  const [template, setTemplate] = useState("");
  const [recipients, setRecipients] = useState("");
  const [objective, setObjective] = useState("");
  const [budget, setBudget] = useState("");
  const [segment, setSegment] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const [templates, setTemplates] = useState<CampaignTemplate[]>([]);
  const [templateSource, setTemplateSource] = useState<Source | "loading">("loading");
  const [segments, setSegments] = useState<CampaignSegment[]>([]);
  const [segmentSource, setSegmentSource] = useState<Source | "loading">("loading");

  useEffect(() => {
    if (!open) return;
    // Reset the form each time the dialog opens.
    setName("");
    setTemplate("");
    setRecipients("");
    setObjective("");
    setBudget("");
    setSegment("");
    setScheduledAt("");
    setAttempted(false);
    setError("");
    let live = true;
    void (async () => {
      setTemplateSource("loading");
      const t = await getCampaignTemplates();
      if (!live) return;
      setTemplates(t.data);
      setTemplateSource(t.source);
    })();
    void (async () => {
      setSegmentSource("loading");
      const s = await getCampaignSegments();
      if (!live) return;
      setSegments(s.data);
      setSegmentSource(s.source);
    })();
    return () => {
      live = false;
    };
  }, [open]);

  // Budget is optional. When present it must convert cleanly to paise.
  const budgetMinor = useMemo(() => (budget.trim() ? rupeesToMinorString(budget) : null), [budget]);
  const budgetInvalid = budget.trim().length > 0 && budgetMinor === null;

  // Recipients are split on commas / newlines; the backend requires at least one.
  const recipientList = useMemo(
    () =>
      recipients
        .split(/[\n,]/)
        .map((r) => r.trim())
        .filter((r) => r.length > 0),
    [recipients],
  );

  const nameMissing = name.trim().length === 0;
  const templateMissing = template.trim().length === 0;
  const recipientsMissing = recipientList.length === 0;
  const canSubmit = !nameMissing && !templateMissing && !recipientsMissing && !budgetInvalid;

  async function submit() {
    setAttempted(true);
    setError("");
    if (!canSubmit) return;
    setBusy(true);
    try {
      await createCampaign({
        name: name.trim(),
        templateId: template,
        recipients: recipientList,
        objective: objective.trim() || undefined,
        budgetMinor: budgetMinor ?? undefined,
        currency: budgetMinor ? "INR" : undefined,
        audienceSegmentId: segment || undefined,
        scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : undefined,
      });
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create the campaign.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  return (
    <div
      className="cd-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div
        className="cd-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${nameId}-title`}
        onKeyDown={(e) => {
          if (e.key === "Escape" && !busy) onClose();
        }}
      >
        <h2 className="cd-title" id={`${nameId}-title`}>
          New campaign
        </h2>

        <div style={{ display: "grid", gap: 12 }}>
          <div>
            <label htmlFor={nameId} style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
              Name
            </label>
            <input
              id={nameId}
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={inputStyle}
              aria-required="true"
              aria-invalid={attempted && nameMissing ? true : undefined}
              aria-describedby={attempted && nameMissing ? nameErrId : undefined}
              placeholder="Q3 renewal outreach"
            />
            {attempted && nameMissing ? (
              <p id={nameErrId} role="alert" style={{ fontSize: 12, color: "#b42318", margin: "4px 0 0" }}>
                A campaign name is required.
              </p>
            ) : null}
          </div>

          <div>
            <label htmlFor={templateId} style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
              Template
            </label>
            <select
              id={templateId}
              value={template}
              onChange={(e) => setTemplate(e.target.value)}
              style={inputStyle}
              aria-required="true"
              aria-invalid={attempted && templateMissing ? true : undefined}
              aria-describedby={attempted && templateMissing ? templateErrId : undefined}
            >
              <option value="">Select a template…</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                  {t.channel ? ` (${t.channel})` : ""}
                </option>
              ))}
            </select>
            {templateSource === "error" ? (
              <p style={{ fontSize: 12, color: "#92400e", margin: "4px 0 0" }}>
                Templates could not be loaded — showing saved information.
              </p>
            ) : null}
            {attempted && templateMissing ? (
              <p id={templateErrId} role="alert" style={{ fontSize: 12, color: "#b42318", margin: "4px 0 0" }}>
                Select a template to send.
              </p>
            ) : null}
          </div>

          <div>
            <label htmlFor={recipientsId} style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
              Recipients
            </label>
            <textarea
              id={recipientsId}
              value={recipients}
              onChange={(e) => setRecipients(e.target.value)}
              style={{ ...inputStyle, minHeight: 64, resize: "vertical" }}
              rows={3}
              aria-required="true"
              aria-invalid={attempted && recipientsMissing ? true : undefined}
              aria-describedby={recipientsHintId}
              placeholder="One recipient per line, or comma-separated"
            />
            <p id={recipientsHintId} style={{ fontSize: 12, color: attempted && recipientsMissing ? "#b42318" : "var(--muted)", margin: "4px 0 0" }}>
              {recipientList.length > 0
                ? `${recipientList.length} recipient${recipientList.length === 1 ? "" : "s"}`
                : "At least one recipient is required."}
            </p>
          </div>

          <div>
            <label htmlFor={objectiveId} style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
              Objective <span style={{ fontWeight: 400, color: "var(--muted)" }}>(optional)</span>
            </label>
            <input
              id={objectiveId}
              value={objective}
              onChange={(e) => setObjective(e.target.value)}
              style={inputStyle}
              placeholder="Awareness, conversion, re-engagement…"
            />
          </div>

          <div>
            <label htmlFor={budgetId} style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
              Budget (₹) <span style={{ fontWeight: 400, color: "var(--muted)" }}>(optional)</span>
            </label>
            <input
              id={budgetId}
              inputMode="decimal"
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
              style={{ ...inputStyle, textAlign: "right" }}
              aria-invalid={budgetInvalid ? true : undefined}
              aria-describedby={budgetInvalid ? budgetErrId : undefined}
              placeholder="50000.00"
            />
            {budgetInvalid ? (
              <p id={budgetErrId} role="alert" style={{ fontSize: 12, color: "#b42318", margin: "4px 0 0" }}>
                Enter a positive rupee amount with at most two decimal places.
              </p>
            ) : null}
          </div>

          <div>
            <label htmlFor={segmentId} style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
              Audience segment <span style={{ fontWeight: 400, color: "var(--muted)" }}>(optional)</span>
            </label>
            {segmentSource === "error" ? (
              <>
                <input
                  id={segmentId}
                  value={segment}
                  onChange={(e) => setSegment(e.target.value)}
                  style={inputStyle}
                  placeholder="Segment id"
                />
                <p style={{ fontSize: 12, color: "#92400e", margin: "4px 0 0" }}>
                  Segments could not be loaded — enter a segment id, or leave blank.
                </p>
              </>
            ) : (
              <select id={segmentId} value={segment} onChange={(e) => setSegment(e.target.value)} style={inputStyle}>
                <option value="">No segment</option>
                {segments.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div>
            <label htmlFor={scheduledId} style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
              Scheduled at <span style={{ fontWeight: 400, color: "var(--muted)" }}>(optional)</span>
            </label>
            <input
              id={scheduledId}
              type="datetime-local"
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
              style={inputStyle}
            />
          </div>
        </div>

        <div className="cd-error" role="alert" aria-live="assertive">
          {error}
        </div>

        <div className="cd-actions">
          <button type="button" className="btn ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="btn primary" onClick={() => void submit()} disabled={busy} aria-busy={busy}>
            {busy ? "Working…" : "Create campaign"}
          </button>
        </div>
      </div>
    </div>
  );
}
