"use client";
import { useRouter } from "next/navigation";
import { useTransition, type FormEvent } from "react";

interface ReportFiltersProps {
  fromDate?: string;
  toDate?: string;
  divisionId?: string;
}

export function ReportFilters({ fromDate, toDate, divisionId }: ReportFiltersProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function handleApply(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const params = new URLSearchParams();
    const from = (fd.get("fromDate") as string) ?? "";
    const to = (fd.get("toDate") as string) ?? "";
    const div = (fd.get("divisionId") as string) ?? "";
    if (from) params.set("fromDate", from);
    if (to) params.set("toDate", to);
    if (div) params.set("divisionId", div);
    const qs = params.toString();
    startTransition(() => {
      router.push(qs ? `/works/reports?${qs}` : "/works/reports");
    });
  }

  function handleClear() {
    startTransition(() => {
      router.push("/works/reports");
    });
  }

  return (
    <form
      onSubmit={handleApply}
      style={{
        display: "flex",
        alignItems: "flex-end",
        gap: 12,
        flexWrap: "wrap",
        marginBottom: 24,
      }}
    >
      <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13 }}>
        <span>From Date</span>
        <input
          type="date"
          name="fromDate"
          defaultValue={fromDate ?? ""}
          disabled={pending}
          aria-label="Filter from date"
        />
      </label>
      <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13 }}>
        <span>To Date</span>
        <input
          type="date"
          name="toDate"
          defaultValue={toDate ?? ""}
          disabled={pending}
          aria-label="Filter to date"
        />
      </label>
      <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13 }}>
        <span>Division ID</span>
        <input
          type="text"
          name="divisionId"
          defaultValue={divisionId ?? ""}
          disabled={pending}
          placeholder="e.g. DIV-001"
          aria-label="Filter by division ID"
          style={{ width: 140 }}
        />
      </label>
      <button type="submit" className="btn" disabled={pending}>
        {pending ? "Applying…" : "Apply"}
      </button>
      <button
        type="button"
        className="btn ghost"
        disabled={pending}
        onClick={handleClear}
      >
        Clear
      </button>
    </form>
  );
}
