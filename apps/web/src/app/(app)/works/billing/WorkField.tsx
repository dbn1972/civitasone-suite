"use client";

import { EntityPicker } from "@/app/_components/ds";
import { searchWorkOptions, resolveWorkOptions } from "../_data/worksPicker";

/** Strict UUID shape used before an id is placed into a route path. */
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Returns the id only when it is a well-formed UUID (safe for a path segment). */
export function safeWorkId(id: string | null | undefined): string | null {
  const t = (id ?? "").trim();
  return UUID_RE.test(t) ? t : null;
}

/**
 * GAP-WORKS-BILLING-{NEW-MB-01,BILLS-NEW-01,MEASUREMENTS-NEW-02}: the Work
 * field of the billing forms. A work arriving via ?workId= is shown read-only
 * (its label resolved); otherwise it is chosen by number/description through
 * the shared EntityPicker — never a pasted UUID.
 */
export function WorkField({
  id,
  value,
  onChange,
  locked,
}: {
  id: string;
  value: string;
  onChange: (workId: string) => void;
  /** True when the work came from the URL and must not change. */
  locked?: boolean;
}) {
  if (locked) {
    // Work came from ?workId= — show it as a read-only summary, not an input
    // the clerk can retype.
    return (
      <input
        id={id}
        type="text"
        readOnly
        value={value}
        aria-label="Work"
        placeholder="UUID of the work"
        style={{ width: "100%", padding: 8, minHeight: 44, borderRadius: 8, border: "1px solid var(--line)" }}
      />
    );
  }
  return (
    <EntityPicker
      id={id}
      aria-label="Work"
      value={value || null}
      onChange={(v) => onChange((Array.isArray(v) ? v[0] : v) ?? "")}
      search={searchWorkOptions}
      resolve={resolveWorkOptions}
      placeholder="Search by work number or description…"
    />
  );
}
