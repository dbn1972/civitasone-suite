"use client";
/**
 * CampaignList — MK-001. Lists marketing campaigns (name, objective, status,
 * budget, metrics link) with status filtering and pagination, and hosts an
 * inline "New campaign" dialog.
 *
 * A failed list fetch renders a real ds ErrorState with Retry — never a
 * fabricated "0 campaigns" / "ROI 0%" and never the contradictory "showing
 * saved information" copy (nothing is cached; GAP-NOTIFICATIONS-CAMPAIGNS-01).
 *
 * The create dialog uses the shared ds <Modal> (focus trap + restore + inert +
 * ESC), warns before discarding a dirty form, and validates each recipient
 * token (email / Indian mobile / handle) with a visible cap and a consent
 * notice — personal data typed by hand must not go out unchecked
 * (GAP-NOTIFICATIONS-CAMPAIGNS-02 / -04).
 *
 * Budget is entered as a rupee decimal and converted to a paise integer STRING
 * with rupeesToMinorString (no float); it is displayed with formatMoney.
 */
import { useEffect, useId, useMemo, useState } from "react";
import Link from "next/link";
import { Button, ConfirmDialog, ErrorState, Modal, Segmented } from "@/app/_components/ds";
import { StatusBadge } from "../../_components/StatusBadge";
import { formatMoney } from "@/lib/formatters";
import { toHumanError } from "@/lib/messages";
import { useFormError } from "@/lib/useFormError";
import { rupeesToMinorString } from "@/lib/money";
import {
  CAMPAIGN_RECIPIENT_LIMIT,
  validateRecipientTokens,
} from "@/lib/form-validation";
import {
  getCampaigns,
  getCampaignTemplates,
  getCampaignSegments,
  createCampaign,
  campaignStatusLabel,
  CAMPAIGN_STATUSES,
  type Campaign,
  type CampaignStatus,
  type CampaignTemplate,
  type CampaignSegment,
  type Source,
} from "@/lib/notifications/campaigns";

const inputStyle = { padding: 8, minHeight: 38, borderRadius: 8, border: "1px solid var(--line)", width: "100%" } as const;

type ListSource = Source | "loading";
type StatusFilter = "all" | CampaignStatus;

const PAGE_SIZE = 50;

export function CampaignList() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [total, setTotal] = useState<number | undefined>(undefined);
  const [listSource, setListSource] = useState<ListSource>("loading");
  const [offset, setOffset] = useState(0);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  const [open, setOpen] = useState(false);

  async function load(nextOffset = offset, isLive: () => boolean = () => true) {
    setListSource("loading");
    const { data, total: t, source } = await getCampaigns(PAGE_SIZE, nextOffset);
    if (!isLive()) return;
    setCampaigns(data);
    setTotal(t);
    setListSource(source);
  }

  useEffect(() => {
    let live = true;
    void load(offset, () => live);
    return () => {
      live = false;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- load only closes over offset, listed here.
  }, [offset]);

  // GAP-NOTIFICATIONS-CAMPAIGNS-05: the list endpoint has no status filter, so
  // filter the current page client-side. Default newest-first by createdAt when
  // present (the API order is not guaranteed).
  const visible = useMemo(() => {
    const sorted = [...campaigns].sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
    if (statusFilter === "all") return sorted;
    return sorted.filter((c) => c.status === statusFilter);
  }, [campaigns, statusFilter]);

  const page = Math.floor(offset / PAGE_SIZE) + 1;
  const hasNext = total !== undefined ? offset + PAGE_SIZE < total : campaigns.length === PAGE_SIZE;
  const hasPrev = offset > 0;

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div className="card">
        <div className="card-h">
          <h3>Campaigns</h3>
          <Button size="sm" onClick={() => setOpen(true)}>
            New campaign
          </Button>
        </div>

        {listSource !== "loading" && listSource !== "error" ? (
          <div style={{ padding: "0 12px 8px" }}>
            <Segmented
              value={statusFilter === "all" ? "All" : campaignStatusLabel(statusFilter)}
              onChange={(label) => {
                if (label === "All") setStatusFilter("all");
                else {
                  const match = CAMPAIGN_STATUSES.find((s) => campaignStatusLabel(s) === label);
                  if (match) setStatusFilter(match);
                }
              }}
              options={["All", ...CAMPAIGN_STATUSES.map((s) => campaignStatusLabel(s))]}
            />
          </div>
        ) : null}

        {listSource === "loading" ? (
          <p role="status" aria-live="polite" style={{ fontSize: 13, color: "var(--muted)", padding: "0 12px" }}>
            Loading campaigns…
          </p>
        ) : listSource === "error" ? (
          // GAP-NOTIFICATIONS-CAMPAIGNS-01: one honest error + Retry; never
          // "showing saved information" (there is no cache).
          <ErrorState error={toHumanError("load", { area: "campaigns" })} onRetry={() => void load()} />
        ) : campaigns.length === 0 ? (
          // Only ever "No campaigns yet" for a successful, genuinely empty load.
          <EmptyNoCampaigns />
        ) : visible.length === 0 ? (
          <p style={{ fontSize: 13, color: "var(--muted)", padding: 12, margin: 0 }}>
            No {statusFilter === "all" ? "" : `${campaignStatusLabel(statusFilter).toLowerCase()} `}campaigns on this page.
          </p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Objective</th>
                  <th scope="col">Status</th>
                  <th scope="col" className="num">Budget</th>
                  <th scope="col">
                    <span className="sr-only">Open</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {visible.map((c) => (
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
                      <Link className="btn ghost sm" href={`/notifications/campaigns/${c.id}`}>
                        Open
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* GAP-NOTIFICATIONS-CAMPAIGNS-05: pager driven by the API's total. */}
        {listSource === "api" && campaigns.length > 0 && (total === undefined || total > PAGE_SIZE) ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: 12 }}>
            <span style={{ fontSize: 13, color: "var(--muted)" }}>
              {total !== undefined
                ? `Showing ${offset + 1}–${offset + campaigns.length} of ${total}`
                : `Page ${page}`}
            </span>
            <div style={{ display: "flex", gap: 8 }}>
              <Button size="sm" variant="ghost" disabled={!hasPrev} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>
                Previous
              </Button>
              <Button size="sm" variant="ghost" disabled={!hasNext} onClick={() => setOffset(offset + PAGE_SIZE)}>
                Next
              </Button>
            </div>
          </div>
        ) : null}
      </div>

      <CreateCampaignDialog
        open={open}
        onClose={() => setOpen(false)}
        onCreated={() => {
          setOpen(false);
          setOffset(0);
          void load(0);
        }}
      />
    </div>
  );
}

function EmptyNoCampaigns() {
  return (
    <div className="empty-state" style={{ textAlign: "center" }}>
      <div className="ic" aria-hidden="true">📣</div>
      <h4>No campaigns yet</h4>
      <p>Create a campaign to reach an audience segment and track its ROI.</p>
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
  const recipientsErrId = useId();
  const consentNoteId = useId();

  const [name, setName] = useState("");
  const [template, setTemplate] = useState("");
  const [recipients, setRecipients] = useState("");
  const [objective, setObjective] = useState("");
  const [budget, setBudget] = useState("");
  const [segment, setSegment] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  const formError = useFormError("campaign");
  const [error, setError] = useState("");
  const [discardOpen, setDiscardOpen] = useState(false);

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
    setDiscardOpen(false);
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

  // Recipients are split on commas / newlines; the backend requires at least one
  // AND expands no segment for you, so each token must be a real address.
  const recipientList = useMemo(
    () =>
      recipients
        .split(/[\n,]/)
        .map((r) => r.trim())
        .filter((r) => r.length > 0),
    [recipients],
  );
  const recipientCheck = useMemo(() => validateRecipientTokens(recipientList), [recipientList]);

  const nameMissing = name.trim().length === 0;
  const templateMissing = template.trim().length === 0;
  const recipientsMissing = recipientList.length === 0;
  const recipientsInvalid = recipientCheck.invalid.length > 0 || recipientCheck.overLimit;
  const canSubmit = !nameMissing && !templateMissing && !recipientsMissing && !recipientsInvalid && !budgetInvalid;

  // GAP-NOTIFICATIONS-CAMPAIGNS-04: a dirty form must not be discarded silently.
  const dirty =
    name.trim().length > 0 ||
    template.length > 0 ||
    recipients.trim().length > 0 ||
    objective.trim().length > 0 ||
    budget.trim().length > 0 ||
    segment.length > 0 ||
    scheduledAt.length > 0;

  function requestClose() {
    if (busy) return;
    if (dirty) setDiscardOpen(true);
    else onClose();
  }

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
      setError(formError.fromException("save", e).message);
    } finally {
      setBusy(false);
    }
  }

  const recipientHelp =
    recipientsMissing
      ? "At least one recipient is required."
      : recipientCheck.overLimit
        ? `Too many recipients — the limit is ${CAMPAIGN_RECIPIENT_LIMIT.toLocaleString("en-IN")}.`
        : recipientCheck.invalid.length > 0
          ? `${recipientCheck.invalid.length} invalid: ${recipientCheck.invalid.slice(0, 3).join(", ")}${recipientCheck.invalid.length > 3 ? "…" : ""}`
          : `${recipientList.length} recipient${recipientList.length === 1 ? "" : "s"}`;

  return (
    <>
      <Modal
        open={open}
        onClose={requestClose}
        title="New campaign"
        size="lg"
        closeOnOverlayClick={!busy}
        describedById={consentNoteId}
      >
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
                Templates could not be loaded. Try again.
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
              aria-invalid={attempted && (recipientsMissing || recipientsInvalid) ? true : undefined}
              aria-describedby={`${recipientsHintId} ${attempted && recipientsInvalid ? recipientsErrId : ""} ${consentNoteId}`.trim()}
              placeholder="One recipient per line, or comma-separated"
            />
            <p
              id={recipientsHintId}
              style={{ fontSize: 12, color: attempted && (recipientsMissing || recipientsInvalid) ? "#b42318" : "var(--muted)", margin: "4px 0 0" }}
            >
              {recipientHelp}
            </p>
            {attempted && recipientsInvalid ? (
              <p id={recipientsErrId} role="alert" style={{ fontSize: 12, color: "#b42318", margin: "4px 0 0" }}>
                {recipientCheck.overLimit
                  ? "Reduce the number of recipients before sending."
                  : "Each recipient must be a valid email, Indian mobile number, or user handle."}
              </p>
            ) : null}
            {/* GAP-NOTIFICATIONS-CAMPAIGNS-02: DPDP consent notice beside the raw
                personal-data field. */}
            <p id={consentNoteId} style={{ fontSize: 12, color: "var(--muted)", margin: "6px 0 0" }}>
              Only contact people who have consented to marketing. Recipients who have opted out or set
              Do-Not-Disturb are skipped automatically when the campaign is sent.
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
          <Button variant="ghost" onClick={requestClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={busy} aria-busy={busy}>
            {busy ? "Working…" : "Create campaign"}
          </Button>
        </div>
      </Modal>

      {/* GAP-NOTIFICATIONS-CAMPAIGNS-04: confirm before throwing away typed data. */}
      <ConfirmDialog
        open={discardOpen}
        danger
        title="Discard this campaign?"
        description="Anything you have typed will be lost."
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        onCancel={() => setDiscardOpen(false)}
        onConfirm={() => {
          setDiscardOpen(false);
          onClose();
        }}
      />
    </>
  );
}
