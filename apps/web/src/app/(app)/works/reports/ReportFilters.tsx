"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { Button, EntityPicker } from "@/app/_components/ds";
import { searchDivisions, resolveDivisions } from "@/lib/entityAdapters/division";

interface ReportFiltersProps {
  fromDate?: string;
  toDate?: string;
  divisionId?: string;
}

/** Canonical UUID shape — matches works-service reportFiltersSchema.divisionId.uuid(). */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function ReportFilters({ fromDate, toDate, divisionId }: ReportFiltersProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // Controlled so To's min / From's max track live, and so we can block an
  // inverted range before navigating (GAP-WORKS-REPORTS-04).
  const [from, setFrom] = useState(fromDate ?? "");
  const [to, setTo] = useState(toDate ?? "");
  // GAP-WORKS-REPORTS-01: the division is now chosen via EntityPicker (name ->
  // uuid), so divisionId holds a real works.divisions id, never a typed code.
  const [division, setDivision] = useState<string | null>(divisionId ?? null);
  const [error, setError] = useState<string | null>(null);

  function handleApply(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const div = (division ?? "").trim();

    if (from && to && to < from) {
      setError("“To” date must be on or after the “From” date.");
      return;
    }
    // Defence in depth: the picker only ever yields a real uuid, but keep the
    // guard so a seeded/garbage value can never navigate to an empty register.
    if (div && !UUID_RE.test(div)) {
      setError("Select a division from the list.");
      return;
    }
    setError(null);

    const params = new URLSearchParams();
    if (from) params.set("fromDate", from);
    if (to) params.set("toDate", to);
    if (div) params.set("divisionId", div);
    const qs = params.toString();
    startTransition(() => {
      router.push(qs ? `/works/reports?${qs}` : "/works/reports");
    });
  }

  function handleClear() {
    setFrom("");
    setTo("");
    setDivision(null);
    setError(null);
    startTransition(() => {
      router.push("/works/reports");
    });
  }

  const activeChips: { label: string }[] = [];
  if (fromDate) activeChips.push({ label: `From ${fromDate}` });
  if (toDate) activeChips.push({ label: `To ${toDate}` });
  if (divisionId) activeChips.push({ label: `Division ${divisionId}` });

  return (
    <div style={{ marginBottom: 24 }}>
      <form
        onSubmit={handleApply}
        style={{
          display: "flex",
          alignItems: "flex-end",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13 }}>
          <span>From Date</span>
          <input
            type="date"
            name="fromDate"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            disabled={pending}
            aria-label="Filter from date"
            aria-invalid={error ? true : undefined}
          />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13 }}>
          <span>To Date</span>
          <input
            type="date"
            name="toDate"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            disabled={pending}
            aria-label="Filter to date"
            aria-invalid={error ? true : undefined}
          />
        </label>
        <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13 }}>
          <span>Division</span>
          <div style={{ width: 240 }}>
            <EntityPicker
              value={division}
              onChange={(v) => setDivision(Array.isArray(v) ? (v[0] ?? null) : v)}
              search={searchDivisions}
              resolve={resolveDivisions}
              {...(divisionId ? { initialOptions: [{ id: divisionId, label: divisionId }] } : {})}
              disabled={pending}
              minQueryLength={1}
              aria-label="Filter by division"
              placeholder="Search division by name…"
            />
          </div>
        </div>
        <Button type="submit" disabled={pending}>
          {pending ? "Applying…" : "Apply"}
        </Button>
        <Button variant="ghost" disabled={pending} onClick={handleClear}>
          Clear
        </Button>
      </form>

      {error ? (
        <p role="alert" style={{ margin: "8px 0 0", fontSize: 13, color: "var(--bad, #b42318)" }}>
          {error}
        </p>
      ) : null}

      {activeChips.length > 0 ? (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10, alignItems: "center" }}>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>Active filters:</span>
          {activeChips.map((chip) => (
            <span
              key={chip.label}
              style={{
                fontSize: 12,
                padding: "3px 10px",
                borderRadius: 999,
                background: "var(--surface, #f1f5f9)",
                border: "1px solid var(--line)",
              }}
            >
              {chip.label}
            </span>
          ))}
          <button
            type="button"
            onClick={handleClear}
            disabled={pending}
            style={{
              fontSize: 12,
              border: "none",
              background: "none",
              color: "var(--primary, var(--accent))",
              cursor: pending ? "default" : "pointer",
              textDecoration: "underline",
              padding: 0,
            }}
          >
            Clear all
          </button>
        </div>
      ) : null}
    </div>
  );
}
