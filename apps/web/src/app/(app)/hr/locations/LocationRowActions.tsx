"use client";

import { useRouter } from "next/navigation";
import { ActionButton } from "../../../_components/ds";

/**
 * Per-row Archive action for /hr/locations (GAP-HR-LOCATIONS-02).
 *
 * Reuses the same PATCH /api/proxy/v1/locations/:id/archive endpoint the
 * sibling /locations/list screen already calls successfully
 * (LocationActions.tsx's `archive()`) -- that endpoint and the
 * reason-prompting ActionButton pattern already exist and work; this page
 * just never wired to them. A full "Edit" action (renamed fields, not just
 * lifecycle) is intentionally NOT added here -- hr.md's own catalog entry
 * marks GAP-HR-LOCATIONS-02 as depending on GAP-HR-LOCATIONS-NEW-01 (the
 * create form gaining a parent/state/district selector), since editing
 * should reuse that same, by-then-complete form rather than being built
 * twice. That dependency is a different page, out of this lane's scope.
 */
export function LocationRowActions({ id, name }: { id: string; name: string }) {
  const router = useRouter();

  async function archive(reason?: string) {
    const res = await fetch(`/api/proxy/v1/locations/${id}/archive`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: reason || undefined }),
    });
    if (!res.ok) throw new Error(await res.text());
    router.refresh();
  }

  return (
    <ActionButton
      label="Archive"
      className="btn ghost"
      danger
      requireReason
      reasonLabel="Reason for archiving"
      confirmTitle="Archive this location?"
      confirmDescription={`This will archive "${name}". Archived locations are hidden from active operations and cannot be selected for new records.`}
      confirmLabel="Archive location"
      onConfirm={archive}
      onSuccess={() => router.refresh()}
    />
  );
}
