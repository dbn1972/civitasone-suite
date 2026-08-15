/**
 * ShiftCard — visual card displaying a single shift definition with time slots.
 * GoI context: Govt working hours per DoPT O.M. are 09:00–17:30 Mon–Fri.
 */
"use client";

import { StatusPill } from "@/app/_components/ds";

export interface ShiftCardProps {
  id: string;
  name: string;
  startTime: string;
  endTime: string;
  breakDuration: string;
  workingHours: string;
  applicableTo: string;
  status: string;
}

const SHIFT_ICONS: Record<string, string> = {
  morning: "🌅",
  general: "🏢",
  evening: "🌆",
  night: "🌙",
  afternoon: "☀️",
};

function shiftIcon(name: string): string {
  const key = name.toLowerCase();
  for (const [k, v] of Object.entries(SHIFT_ICONS)) {
    if (key.includes(k)) return v;
  }
  return "⏰";
}

export function ShiftCard({ name, startTime, endTime, breakDuration, workingHours, applicableTo, status }: ShiftCardProps) {
  return (
    <article
      className="shift-card"
      aria-label={`${name} shift`}
      style={{
        border: "1px solid var(--border, #e5e7eb)",
        borderRadius: 10,
        padding: "16px 18px",
        background: "var(--surface, #fff)",
        display: "flex",
        flexDirection: "column",
        gap: 10,
        minWidth: 220,
      }}
    >
      <header style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span role="img" aria-hidden style={{ fontSize: 22 }}>{shiftIcon(name)}</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: 15 }}>{name}</div>
          <div style={{ fontSize: 12, color: "var(--muted, #6b7280)" }}>{applicableTo}</div>
        </div>
        <StatusPill status={status} />
      </header>

      <dl
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "6px 12px",
          margin: 0,
          padding: "10px 12px",
          background: "var(--surface-2, #f9fafb)",
          borderRadius: 6,
        }}
      >
        <TimeSlot label="Start" value={startTime} />
        <TimeSlot label="End" value={endTime} />
        <TimeSlot label="Break" value={breakDuration} />
        <TimeSlot label="Total" value={workingHours} highlight />
      </dl>
    </article>
  );
}

function TimeSlot({ label, value, highlight = false }: { label: string; value: string; highlight?: boolean }) {
  return (
    <>
      <dt style={{ fontSize: 11, color: "var(--muted, #6b7280)", margin: 0, alignSelf: "center" }}>{label}</dt>
      <dd
        style={{
          fontSize: 13,
          fontWeight: highlight ? 600 : 400,
          color: highlight ? "var(--primary, #2563eb)" : "var(--text, #111827)",
          margin: 0,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </dd>
    </>
  );
}
