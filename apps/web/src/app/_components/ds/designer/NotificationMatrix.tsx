"use client";

import { useMemo, useState } from "react";
import { FormRenderer } from "./FormRenderer";
import { LocaleTabs, type LocaleKey } from "./LocaleTabs";
import { MergeFieldPicker, type MergeField } from "./MergeFieldPicker";
import { SplitPreview } from "./SplitPreview";
import type { FormDesignState } from "./formTypes";
import {
  NOTIFICATION_CHANNELS,
  NOTIFICATION_EVENTS,
  applyMergeSample,
  cellChipLabel,
  channelLabel,
  channelPreviewTitle,
  disableCell,
  enableCell,
  eventLabel,
  eventsForPattern,
  patchCell,
  smsStats,
  type NotificationCellBinding,
  type NotificationChannel,
  type NotificationEvent,
  type NotificationMatrixState,
} from "./notificationTypes";

export interface NotificationMatrixProps {
  matrix: NotificationMatrixState;
  onChange: (matrix: NotificationMatrixState) => void;
  /** Service pattern — dims events that are not typical defaults. */
  pattern?: string;
  mergeFields?: MergeField[];
  /** When set, SplitPreview hosts FormRenderer for sample answers (P3 / FN-13). */
  sampleFormDesign?: FormDesignState;
  sampleValues?: Record<string, string>;
  onSampleValuesChange?: (values: Record<string, string>) => void;
}

function ChannelCitizenPreview({
  channel,
  subject,
  body,
  locale,
}: {
  channel: NotificationChannel;
  subject: string;
  body: string;
  locale: LocaleKey;
}) {
  if (channel === "sms") {
    return (
      <div
        data-testid="channel-preview-sms"
        style={{
          maxWidth: 280,
          margin: "0 auto",
          padding: "12px 14px",
          borderRadius: 18,
          background: "var(--panel)",
          border: "1px solid var(--line)",
          boxShadow: "var(--shadow-sm)",
          fontSize: 14,
          lineHeight: 1.4,
        }}
        lang={locale}
      >
        {body || "Preview…"}
      </div>
    );
  }
  if (channel === "whatsapp") {
    return (
      <div
        data-testid="channel-preview-whatsapp"
        style={{
          maxWidth: 280,
          margin: "0 auto",
          padding: "10px 12px",
          borderRadius: "12px 12px 12px 4px",
          background: "var(--good-bg)",
          border: "1px solid var(--good-border)",
          fontSize: 13,
          lineHeight: 1.45,
          color: "var(--ink)",
        }}
        lang={locale}
      >
        {body || "Preview…"}
      </div>
    );
  }
  if (channel === "email") {
    return (
      <div
        data-testid="channel-preview-email"
        style={{
          border: "1px solid var(--line)",
          borderRadius: "var(--r-sm)",
          background: "var(--panel)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            padding: "8px 12px",
            borderBottom: "1px solid var(--line)",
            fontSize: 12,
            color: "var(--mut)",
          }}
        >
          Subject:{" "}
          <strong style={{ color: "var(--ink)" }} lang={locale}>
            {subject || "(no subject)"}
          </strong>
        </div>
        <div style={{ padding: 12, fontSize: 13, lineHeight: 1.5, whiteSpace: "pre-wrap" }} lang={locale}>
          {body || "Preview…"}
        </div>
      </div>
    );
  }
  return (
    <div
      data-testid="channel-preview-in-app"
      style={{
        display: "flex",
        gap: 10,
        alignItems: "flex-start",
        padding: "10px 12px",
        borderRadius: "var(--r-sm)",
        border: "1px solid var(--info-border)",
        background: "var(--info-bg)",
      }}
    >
      <span
        aria-hidden
        style={{
          width: 8,
          height: 8,
          marginTop: 6,
          borderRadius: "50%",
          background: "var(--info-fg)",
          flexShrink: 0,
        }}
      />
      <p style={{ margin: 0, fontSize: 13, lineHeight: 1.45 }} lang={locale}>
        {body || "Preview…"}
      </p>
    </div>
  );
}

export function NotificationMatrix({
  matrix,
  onChange,
  pattern = "certificate",
  mergeFields,
  sampleFormDesign,
  sampleValues = {},
  onSampleValuesChange,
}: NotificationMatrixProps) {
  const [editing, setEditing] = useState<{ event: NotificationEvent; channel: NotificationChannel } | null>(null);
  const [locale, setLocale] = useState<LocaleKey>("en");
  const [previewOpen, setPreviewOpen] = useState(true);
  const [previewRevision, setPreviewRevision] = useState(0);

  const activeEvents = useMemo(() => new Set(eventsForPattern(pattern)), [pattern]);

  const openOrEnableCell = (event: NotificationEvent, channel: NotificationChannel) => {
    const cell = matrix[event]?.[channel];
    if (cell?.enabled) {
      // UX §5.11 — enabled cells open the editor; do not turn off on first click
      setEditing({ event, channel });
      setPreviewOpen(true);
      return;
    }
    onChange(enableCell(matrix, event, channel));
    setEditing({ event, channel });
    setPreviewOpen(true);
  };

  const disableEditingCell = () => {
    if (!editing) return;
    onChange(disableCell(matrix, editing.event, editing.channel));
    setEditing(null);
  };

  const updateEditing = (patch: Partial<NotificationCellBinding>) => {
    if (!editing) return;
    onChange(patchCell(matrix, editing.event, editing.channel, patch));
    setPreviewRevision((n) => n + 1);
  };

  const editingCell = editing
    ? (matrix[editing.event]?.[editing.channel] ?? {
        enabled: true,
        body: { en: "", hi: "" },
      })
    : undefined;

  const sms =
    editing && editing.channel === "sms" && editingCell ? smsStats(editingCell.body[locale]) : null;

  const previewBody = editingCell
    ? applyMergeSample(editingCell.body[locale] ?? "", sampleValues)
    : "";
  const previewSubject = editingCell
    ? applyMergeSample(editingCell.subject?.[locale] ?? "", sampleValues)
    : "";

  return (
    <div>
      <div style={{ overflowX: "auto" }}>
        <table className="data-table" aria-label="Notification matrix" style={{ width: "100%", minWidth: 560 }}>
          <thead>
            <tr>
              <th scope="col">Event</th>
              {NOTIFICATION_CHANNELS.map((ch) => (
                <th key={ch.id} scope="col" title={ch.hint}>
                  {ch.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {NOTIFICATION_EVENTS.map((ev) => {
              const inPattern = activeEvents.has(ev.id);
              return (
                <tr
                  key={ev.id}
                  style={{ opacity: inPattern ? 1 : 0.55 }}
                  title={
                    inPattern
                      ? ev.hint
                      : `${ev.hint} (not typical for this service pattern — still editable)`
                  }
                >
                  <th scope="row" style={{ textAlign: "start", fontWeight: 500 }}>
                    {ev.label}
                    {!inPattern ? (
                      <span style={{ display: "block", fontSize: 11, fontWeight: 400, color: "var(--mut)" }}>
                        optional for this pattern
                      </span>
                    ) : null}
                  </th>
                  {NOTIFICATION_CHANNELS.map((ch) => {
                    const cell = matrix[ev.id]?.[ch.id];
                    const on = cell?.enabled ?? false;
                    const label = cellChipLabel(cell);
                    return (
                      <td key={ch.id}>
                        <button
                          type="button"
                          className={on ? "btn primary" : "btn ghost"}
                          aria-pressed={on}
                          aria-label={
                            on
                              ? `Edit ${ev.label} ${ch.label} template`
                              : `Enable ${ev.label} ${ch.label}`
                          }
                          data-testid={`cell-${ev.id}-${ch.id}`}
                          onClick={() => openOrEnableCell(ev.id, ch.id)}
                          style={{
                            fontSize: 12,
                            padding: "4px 8px",
                            minHeight: 32,
                            maxWidth: 140,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {label}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {editing && editingCell ? (
        <div
          data-testid="notification-template-editor"
          style={{
            marginTop: 16,
            display: "grid",
            gridTemplateColumns: previewOpen ? "minmax(0, 1fr) minmax(280px, 380px)" : "1fr",
            gap: 16,
            alignItems: "start",
          }}
        >
          <div
            style={{
              padding: 16,
              border: "1px solid var(--line)",
              borderRadius: "var(--r-sm)",
              background: "var(--panel)",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 8,
                flexWrap: "wrap",
                marginBottom: 8,
              }}
            >
              <h4 style={{ margin: 0 }}>
                Edit template — {eventLabel(editing.event)} / {channelLabel(editing.channel)}
              </h4>
              <span
                data-testid="channel-enabled-badge"
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  padding: "2px 8px",
                  borderRadius: 999,
                  background: editingCell.enabled ? "var(--good-bg)" : "var(--bg)",
                  color: editingCell.enabled ? "var(--good-fg)" : "var(--mut)",
                  border: `1px solid ${editingCell.enabled ? "var(--good-border)" : "var(--line)"}`,
                  alignSelf: "center",
                }}
              >
                {editingCell.enabled ? "Enabled" : "Disabled"}
              </span>
            </div>

            <LocaleTabs
              active={locale}
              onChange={setLocale}
              completeness={{
                en: Boolean(editingCell.body.en.trim()),
                hi: Boolean(editingCell.body.hi.trim()),
              }}
            />

            {editing.channel === "email" ? (
              <label style={{ display: "block", marginBottom: 8 }}>
                <span style={{ fontSize: 12, color: "var(--mut)" }}>
                  Subject ({locale === "hi" ? "हिंदी" : "English"})
                </span>
                <input
                  aria-label="Email subject"
                  data-testid="template-subject"
                  value={editingCell.subject?.[locale] ?? ""}
                  onChange={(e) =>
                    updateEditing({
                      subject: {
                        en: editingCell.subject?.en ?? "",
                        hi: editingCell.subject?.hi ?? "",
                        [locale]: e.target.value,
                      },
                    })
                  }
                  style={{ width: "100%" }}
                />
              </label>
            ) : null}

            <label style={{ display: "block", marginBottom: 8 }}>
              <span style={{ fontSize: 12, color: "var(--mut)" }}>
                Message ({locale === "hi" ? "हिंदी" : "English"})
              </span>
              <textarea
                rows={4}
                aria-label="Message body"
                data-testid="template-body"
                lang={locale}
                value={editingCell.body[locale]}
                onChange={(e) =>
                  updateEditing({
                    body: { ...editingCell.body, [locale]: e.target.value },
                  })
                }
                style={{ width: "100%" }}
              />
            </label>

            <MergeFieldPicker
              fields={mergeFields}
              onInsert={(token) =>
                updateEditing({
                  body: { ...editingCell.body, [locale]: `${editingCell.body[locale]}${token}` },
                })
              }
            />

            {sms ? (
              <p
                data-testid="sms-stats"
                style={{ fontSize: 12, color: sms.warn ? "var(--warn-fg)" : "var(--mut)" }}
              >
                {sms.chars} character{sms.chars === 1 ? "" : "s"} · {sms.segments} SMS segment
                {sms.segments === 1 ? "" : "s"}
                {sms.warn ? ` — ${sms.warn}` : ""}
              </p>
            ) : null}

            <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                type="button"
                className="btn primary"
                data-testid="template-done"
                onClick={() => setEditing(null)}
              >
                Done
              </button>
              <button
                type="button"
                className="btn ghost"
                data-testid="template-turn-off"
                onClick={disableEditingCell}
              >
                Turn off this channel
              </button>
              {!previewOpen ? (
                <button type="button" className="btn ghost" onClick={() => setPreviewOpen(true)}>
                  Show preview
                </button>
              ) : null}
            </div>
          </div>

          {previewOpen ? (
            <SplitPreview
              open={previewOpen}
              onToggle={() => setPreviewOpen(false)}
              revision={previewRevision}
              debounceMs={200}
            >
              <div style={{ display: "grid", gap: 16 }}>
                <div>
                  <p style={{ margin: "0 0 8px", fontSize: 12, fontWeight: 600, color: "var(--ink2)" }}>
                    {channelPreviewTitle(editing.channel)}
                  </p>
                  <ChannelCitizenPreview
                    channel={editing.channel}
                    subject={previewSubject}
                    body={previewBody}
                    locale={locale}
                  />
                </div>
                {sampleFormDesign ? (
                  <div data-testid="notification-sample-form">
                    <p style={{ margin: "0 0 8px", fontSize: 12, fontWeight: 600, color: "var(--ink2)" }}>
                      Sample answers (same FormRenderer as Apply)
                    </p>
                    <FormRenderer
                      design={sampleFormDesign}
                      showRuntimeNote={false}
                      values={sampleValues}
                      onChange={onSampleValuesChange}
                    />
                  </div>
                ) : null}
              </div>
            </SplitPreview>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
