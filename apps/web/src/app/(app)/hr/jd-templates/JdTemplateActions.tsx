"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ConfirmDialog } from "@/app/_components/ds/ConfirmDialog";
import { AcceptedNotice, Button } from "@/app/_components/ds";
import { useAcceptedWrite } from "@/lib/useAcceptedWrite";

/**
 * GAP-HR-JD-TEMPLATES-04: DELETE /v1/hrms/jd-templates/:id (archive --
 * soft-delete via `isArchived`, jd-template-routes.ts) has existed on the
 * backend with no UI anywhere on this page -- an obsolete template could
 * never be retired. Archive is queue-backed (recruitment/consumer.ts) and
 * archived templates are also rejected by the /use endpoint, so this is a
 * confirm-gated, low-risk soft-delete, not a destructive one.
 *
 * The route only PUBLISHES the archive command and replies, so the template
 * is still in the library for a moment afterwards. This used to call
 * router.refresh() straight away, which re-rendered the list before the
 * consumer had run and left the "archived" card on screen. It now follows the
 * shared 202 convention (useAcceptedWrite / AcceptedNotice): the card shows
 * "request received", polls the template's own GET until it reports
 * isArchived, and only then refreshes the list -- never claiming it is gone
 * before it is.
 */
export function ArchiveTemplateButton({ id, name }: { id: string; name: string }) {
  const t = useTranslations("jdTemplates");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const accepted = useAcceptedWrite<void, { isArchived?: boolean }>({
    // GET /v1/hrms/jd-templates/:id returns archived templates too (only the
    // list filters them out), so it can be polled until it reports the flag.
    poll: async () => {
      const res = await fetch(`/api/proxy/v1/hrms/jd-templates/${encodeURIComponent(id)}`);
      if (!res.ok) throw new Error("template not readable yet");
      return (await res.json()) as { isArchived?: boolean };
    },
    isDone: (p) => p.isArchived === true,
    initialDelayMs: 600,
    maxAttempts: 6,
  });

  async function handleConfirm() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/proxy/v1/hrms/jd-templates/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!res.ok) {
        // Fixed, translated copy -- never the raw server message.
        setError(t("archiveFailed"));
        setBusy(false);
        return;
      }
      setOpen(false);
      setBusy(false);
      void accepted.accept();
    } catch {
      setError(t("networkError"));
      setBusy(false);
    }
  }

  if (accepted.phase !== "idle") {
    return (
      <AcceptedNotice
        {...accepted.noticeProps}
        message={t("archiveAccepted", { name })}
      />
    );
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
