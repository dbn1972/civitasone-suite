"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { Button } from "@/app/_components/ds";

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
  const [error, setError] = useState<string | null>(null);

  function handleApply(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const div = ((fd.get("divisionId") as string) ?? "").trim();

    if (from && to && to < from) {
      setError("“To” date must be on or after the “From” date.");
      return;
    }
    // GAP-WORKS-REPORTS-01: the works-service reports accept divisionId only as
    // a UUID (reportFiltersSchema.divisionId.uuid()). A typed code like
    // "DIV-001" silently returns an empty register ("No works match…"). There
    // is no division NAME master to drive an EntityPicker, so until one exists
    // we at least block a non-UUID before navigating, with a precise message.
    if (div && !UUID_RE.test(div)) {
      setError("Division ID must be a valid UUID (copied from the division record).");
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
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13 }}>
          <span>Division</span>
          <input
            type="text"
            name="divisionId"
            defaultValue={divisionId ?? ""}
            disabled={pending}
            placeholder="Division UUID"
            aria-label="Filter by division UUID"
            aria-invalid={error && error.includes("Division") ? true : undefined}
            style={{ width: 220 }}
          />
        </label>
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
