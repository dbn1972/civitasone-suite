"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ConfirmDialog } from "@/app/_components/ds/ConfirmDialog";
import { Button } from "@/app/_components/ds";

/**
 * GAP-HR-JD-TEMPLATES-04: DELETE /v1/hrms/jd-templates/:id (archive --
 * soft-delete via `isArchived`, jd-template-routes.ts) has existed on the
 * backend with no UI anywhere on this page -- an obsolete template could
 * never be retired. Archive is queue-backed (recruitment/consumer.ts) and
 * archived templates are also rejected by the /use endpoint, so this is a
 * confirm-gated, low-risk soft-delete, not a destructive one.
 */
export function ArchiveTemplateButton({ id, name }: { id: string; name: string }) {
  const t = useTranslations("jdTemplates");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function handleConfirm() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/proxy/v1/hrms/jd-templates/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({ message: t("archiveFailed") }))) as { message?: string };
        setError(err.message ?? t("archiveFailed"));
        setBusy(false);
        return;
      }
      setOpen(false);
      setBusy(false);
      router.refresh();
    } catch {
      setError(t("networkError"));
      setBusy(false);
    }
  }

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setOpen(true)}
        style={{ padding: "8px 12px" }}
      >
        {t("archive")}
      </Button>
      <ConfirmDialog
        open={open}
        title={t("archiveConfirmTitle")}
        description={t("archiveConfirmMessage", { name })}
        confirmLabel={t("archive")}
        danger
        busy={busy}
        errorMessage={error}
        onConfirm={handleConfirm}
        onCancel={() => {
          setOpen(false);
          setError("");
        }}
      />
    </>
  );
}
