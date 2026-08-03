"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

const OPTIONS = [
  { value: "", label: "All conversations" },
  { value: "active", label: "Active only" },
  { value: "ended", label: "Ended only" },
];

/**
 * Filters by status on the server. The list is paginated by the API, so
 * narrowing client-side would filter only the page already fetched and
 * under-report how many conversations match.
 */
export function StatusFilter() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const selected = searchParams.get("status") ?? "";

  const onChange = (value: string) => {
    const next = new URLSearchParams(searchParams.toString());
    if (value) next.set("status", value);
    else next.delete("status");
    const qs = next.toString();
    startTransition(() => {
      router.replace(qs ? `/ai/chat?${qs}` : "/ai/chat");
    });
  };

  return (
    <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
      <span style={{ fontSize: 13, color: "#475569" }}>Status</span>
      <select
        value={selected}
        disabled={pending}
        onChange={(e) => onChange(e.target.value)}
        aria-label="Filter conversations by status"
      >
        {OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
      {pending && <span style={{ fontSize: 12, color: "#64748b" }}>Loading…</span>}
    </label>
  );
}
