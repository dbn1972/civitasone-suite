"use client";

import { useState } from "react";
import { LocaleTabs, type LocaleKey } from "./LocaleTabs";
import { MergeFieldPicker, renderMergePills } from "./MergeFieldPicker";
import {
  NOTIFICATION_CHANNELS,
  NOTIFICATION_EVENTS,
  smsSegmentCount,
  type NotificationCellBinding,
  type NotificationChannel,
  type NotificationEvent,
  type NotificationMatrixState,
} from "./notificationTypes";

export interface NotificationMatrixProps {
  matrix: NotificationMatrixState;
  onChange: (matrix: NotificationMatrixState) => void;
}

export function NotificationMatrix({ matrix, onChange }: NotificationMatrixProps) {
  const [editing, setEditing] = useState<{ event: NotificationEvent; channel: NotificationChannel } | null>(null);
  const [locale, setLocale] = useState<LocaleKey>("en");

  const toggleCell = (event: NotificationEvent, channel: NotificationChannel) => {
    const cell = matrix[event]?.[channel];
    const nextEnabled = !(cell?.enabled ?? false);
    const next: NotificationMatrixState = {
      ...matrix,
      [event]: {
        ...matrix[event],
        [channel]: {
          enabled: nextEnabled,
          body: cell?.body ?? { en: "", hi: "" },
          subject: cell?.subject,
          templateId: cell?.templateId,
          templateName: cell?.templateName,
        },
      },
    };
    onChange(next);
    if (nextEnabled) setEditing({ event, channel });
  };

  const updateEditing = (patch: Partial<NotificationCellBinding>) => {
    if (!editing) return;
    const { event, channel } = editing;
    const cell = matrix[event]?.[channel] ?? { enabled: true, body: { en: "", hi: "" } };
    onChange({
      ...matrix,
      [event]: {
        ...matrix[event],
        [channel]: { ...cell, ...patch },
      },
    });
  };

  const editingCell = editing ? matrix[editing.event]?.[editing.channel] : undefined;

  return (
    <div>
      <div style={{ overflowX: "auto" }}>
        <table className="data-table" aria-label="Notification matrix" style={{ width: "100%", minWidth: 520 }}>
          <thead>
            <tr>
              <th scope="col">Event</th>
              {NOTIFICATION_CHANNELS.map((ch) => (
                <th key={ch.id} scope="col">{ch.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {NOTIFICATION_EVENTS.map((ev) => (
              <tr key={ev.id}>
                <th scope="row" style={{ textAlign: "left", fontWeight: 500 }}>{ev.label}</th>
                {NOTIFICATION_CHANNELS.map((ch) => {
                  const cell = matrix[ev.id]?.[ch.id];
                  const on = cell?.enabled ?? false;
                  return (
                    <td key={ch.id}>
                      <button
                        type="button"
                        className={on ? "btn primary" : "btn ghost"}
                        aria-pressed={on}
                        onClick={() => toggleCell(ev.id, ch.id)}
                        style={{ fontSize: 12, padding: "4px 8px" }}
                      >
                        {on ? (cell?.templateName ?? "On") : "Off"}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && editingCell ? (
        <div
          style={{
            marginTop: 16,
            padding: 16,
            border: "1px solid var(--line)",
            borderRadius: "var(--r-sm)",
            background: "var(--panel)",
          }}
        >
          <h4 style={{ margin: "0 0 8px" }}>
            Edit template — {NOTIFICATION_EVENTS.find((e) => e.id === editing.event)?.label} / {editing.channel}
          </h4>
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
              <span style={{ fontSize: 12, color: "var(--mut)" }}>Subject</span>
              <input
                value={editingCell.subject?.[locale] ?? ""}
                onChange={(e) => updateEditing({
                  subject: { en: editingCell.subject?.en ?? "", hi: editingCell.subject?.hi ?? "", [locale]: e.target.value },
                })}
                style={{ width: "100%" }}
              />
            </label>
          ) : null}
          <label style={{ display: "block", marginBottom: 8 }}>
            <span style={{ fontSize: 12, color: "var(--mut)" }}>Message</span>
            <textarea
              rows={4}
              value={editingCell.body[locale]}
              onChange={(e) => updateEditing({
                body: { ...editingCell.body, [locale]: e.target.value },
              })}
              style={{ width: "100%" }}
            />
          </label>
          <MergeFieldPicker
            onInsert={(token) => updateEditing({
              body: { ...editingCell.body, [locale]: editingCell.body[locale] + token },
            })}
          />
          {editing.channel === "sms" ? (
            <p style={{ fontSize: 12, color: "var(--mut)" }}>
              {smsSegmentCount(editingCell.body[locale])} SMS segment(s)
            </p>
          ) : null}
          {editing.channel === "whatsapp" ? (
            <div
              style={{
                marginTop: 8,
                maxWidth: 280,
                padding: "10px 12px",
                borderRadius: "12px 12px 12px 4px",
                background: "var(--good-bg)",
                border: "1px solid var(--good-border)",
                fontSize: 13,
              }}
            >
              {renderMergePills(editingCell.body[locale]) || "Preview…"}
            </div>
          ) : null}
          <button type="button" className="btn ghost" onClick={() => setEditing(null)} style={{ marginTop: 8 }}>
            Done
          </button>
        </div>
      ) : null}
    </div>
  );
}
