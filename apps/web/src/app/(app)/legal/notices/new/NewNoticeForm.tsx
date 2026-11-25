"use client";

import { UserFacingError } from "@/lib/userFacingError";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button, ConfirmDialog, useConfirmAction } from "../../../../_components/ds";
import { useFormError } from "@/lib/useFormError";

/**
 * Registers a legal notice via POST /api/v1/legal/notices
 * (createNoticeBody: noticeNo 1..64, subject 1..256, partyRef 1..128, direction sent|received).
 * The command is queued (202); the notice appears in the register once the consumer has
 * processed it. Registering is a permanent legal record, so it is gated behind a ConfirmDialog.
 */
export function NewNoticeForm() {
  const t = useTranslations("legalNotices");
  const router = useRouter();
  const formError = useFormError("legal notice");
  const [noticeNo, setNoticeNo] = useState("");
  const [subject, setSubject] = useState("");
  const [partyRef, setPartyRef] = useState("");
  const [direction, setDirection] = useState<"sent" | "received">("received");
  const [message, setMessage] = useState("");

  const { open, busy, error, trigger, cancel, confirm } = useConfirmAction({
    onConfirm: async () => {
      const res = await fetch("/api/proxy/v1/legal/notices", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          noticeNo: noticeNo.trim(),
          subject: subject.trim(),
          partyRef: partyRef.trim(),
          direction,
        }),
      });
      if (!res.ok) throw UserFacingError.from(await formError.fromResponse(res, "save"));
    },
    onSuccess: () => {
      router.push("/legal/notices");
      router.refresh();
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!noticeNo.trim() || !subject.trim() || !partyRef.trim()) {
      setMessage(t("required"));
      return;
    }
    setMessage("");
    trigger();
  }

  return (
    <form onSubmit={handleSubmit} className="card pad" style={{ maxWidth: 820 }} noValidate>
      <div className="fields">
        <div className="field">
          <label className="label" htmlFor="noticeNo">{t("noticeNoLabel")}</label>
          <input id="noticeNo" className="inp" value={noticeNo} onChange={(e) => setNoticeNo(e.target.value)} required maxLength={64} placeholder={t("noticeNoPlaceholder")} style={{ minHeight: 44 }} />
        </div>
        <div className="field">
          <label className="label" htmlFor="direction">{t("directionLabel")}</label>
          <select id="direction" className="inp" value={direction} onChange={(e) => setDirection(e.target.value as "sent" | "received")} style={{ minHeight: 44 }}>
            <option value="received">{t("directionReceived")}</option>
            <option value="sent">{t("directionSent")}</option>
          </select>
        </div>
        <div className="field" style={{ gridColumn: "1 / -1" }}>
          <label className="label" htmlFor="partyRef">{t("partyLabel")}</label>
          <input id="partyRef" className="inp" value={partyRef} onChange={(e) => setPartyRef(e.target.value)} required maxLength={128} placeholder={t("partyPlaceholder")} style={{ minHeight: 44 }} />
        </div>
        <div className="field" style={{ gridColumn: "1 / -1" }}>
          <label className="label" htmlFor="subject">{t("subjectLabel")}</label>
          <input id="subject" className="inp" value={subject} onChange={(e) => setSubject(e.target.value)} required maxLength={256} placeholder={t("subjectPlaceholder")} style={{ minHeight: 44 }} />
        </div>
      </div>
      <div role="status" aria-live="polite">
        {message ? <p role="alert" style={{ marginTop: 12, color: "var(--bad)", fontSize: "0.875rem" }}>{message}</p> : null}
      </div>
      <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
        <Button type="submit" style={{ minHeight: 44 }} disabled={busy}>{busy ? t("saving") : t("submit")}</Button>
        <Link href="/legal/notices" className="btn ghost" style={{ minHeight: 44 }}>{t("cancel")}</Link>
      </div>
      <ConfirmDialog
        open={open}
        title={t("confirmTitle")}
        description={t("confirmDescription", {
          noticeNo: noticeNo.trim(),
          direction: direction === "sent" ? t("directionSent") : t("directionReceived"),
          party: partyRef.trim(),
        })}
        confirmLabel={t("confirmLabel")}
        busy={busy}
        errorMessage={error}
        onConfirm={() => confirm()}
        onCancel={cancel}
      />
    </form>
  );
}
