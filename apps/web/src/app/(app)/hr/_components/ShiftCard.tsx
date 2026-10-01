/**
 * ShiftCard — visual card displaying a single shift definition with time slots.
 * GoI context: Govt working hours per DoPT O.M. are 09:00–17:30 Mon–Fri.
 */
"use client";

import { useTranslations } from "next-intl";
import { StatusPill } from "@/app/_components/ds";

/**
 * GAP-HR-SHIFTS-04: ShiftCard.test.tsx (pre-existing, 7 cases) renders this
 * component directly with no `<NextIntlClientProvider>` — useTranslations()
 * throws synchronously without one. Mirrors DataTable.tsx's own
 * useSafeTranslations helper (same problem, same fix, not exported from
 * there to import — each component that hits this rolls its own local
 * fallback) so the real page (always wrapped by the root layout) gets the
 * translated string, and every existing test keeps passing unchanged with
 * the plain-English literal it already asserts on.
 */
function useSafeTranslations(namespace: string, fallback: Record<string, string>): (key: string) => string {
  try {
    return useTranslations(namespace);
  } catch {
    return (key: string) => fallback[key] ?? key;
  }
}

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
  // GAP-HR-SHIFTS-04: TimeSlot labels below were hard-coded English literals
  // while the rest of this page (shifts/page.tsx) is next-intl.
  const t = useSafeTranslations("shifts", {
    cardStart: "Start", cardEnd: "End", cardBreak: "Break", cardTotal: "Total",
  });
  return (
    <article
      className="shift-card"
      aria-label={`${name} shift`}
      style={{
        border: "1px solid var(--line, #e5e7eb)",
        borderRadius: 10,
        padding: "16px 18px",
        background: "var(--panel, #fff)",
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
          <div style={{ fontSize: 12, color: "var(--mut, #6b7280)" }}>{applicableTo}</div>
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
          background: "var(--bg, #f9fafb)",
          borderRadius: 6,
        }}
      >
        <TimeSlot label={t("cardStart")} value={startTime} />
        <TimeSlot label={t("cardEnd")} value={endTime} />
        <TimeSlot label={t("cardBreak")} value={breakDuration} />
        <TimeSlot label={t("cardTotal")} value={workingHours} highlight />
      </dl>
    </article>
  );
}

function TimeSlot({ label, value, highlight = false }: { label: string; value: string; highlight?: boolean }) {
  return (
    <>
      <dt style={{ fontSize: 11, color: "var(--mut, #6b7280)", margin: 0, alignSelf: "center" }}>{label}</dt>
      <dd
        style={{
          fontSize: 13,
          fontWeight: highlight ? 600 : 400,
          color: highlight ? "var(--primary, #2563eb)" : "var(--ink, #111827)",
          margin: 0,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </dd>
    </>
  );
}
