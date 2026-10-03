"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useFormError } from "@/lib/useFormError";
import { ActionButton } from "../../../_components/ds";

/**
 * Per-row Edit / Archive actions for /hr/locations (GAP-HR-LOCATIONS-02).
 *
 * Archive calls PATCH /api/proxy/v1/locations/:id/archive (location-service),
 * which refuses while active sub-locations exist and records the reason in the
 * audit event. Edit links to the prefilled add form (hr/locations/[id]/edit).
 * All copy comes from the `locationRowActions` messages; failures go through
 * useFormError so a raw status or server text never reaches the user.
 */
export function LocationRowActions({ id, name, archived = false }: { id: string; name: string; archived?: boolean }) {
  const t = useTranslations("locationRowActions");
  const router = useRouter();
  const formError = useFormError("location");

  async function archive(reason?: string) {
    const res = await fetch(`/api/proxy/v1/locations/${id}/archive`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: reason || undefined }),
    });
    if (!res.ok) {
      const code = await res.clone().json().then((b: { code?: string }) => b.code ?? null).catch(() => null);
      if (code === "HAS_ACTIVE_CHILDREN") throw new Error(t("errHasActiveChildren"));
      if (code === "ALREADY_ARCHIVED") throw new Error(t("errAlreadyArchived"));
      throw new Error((await formError.fromResponse(res, "save")).message);
    }
    router.refresh();
  }

  if (archived) return null;
  return (
    <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
      <Link href={`/hr/locations/${id}/edit`} className="btn ghost" aria-label={t("editAria", { name })}>{t("edit")}</Link>
      <ActionButton
        label={t("archive")}
        className="btn ghost"
        danger
        requireReason
        reasonLabel={t("reasonLabel")}
        confirmTitle={t("confirmTitle")}
        confirmDescription={t("confirmDescription", { name })}
        confirmLabel={t("confirmLabel")}
        onConfirm={archive}
        onSuccess={() => router.refresh()}
      />
    </span>
  );
}
