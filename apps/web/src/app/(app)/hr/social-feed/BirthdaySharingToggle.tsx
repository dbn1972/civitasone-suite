"use client";

/**
 * GAP-HR-SOCIAL-FEED-01 (DPDP): the employee's own birthday-sharing consent.
 *
 * The social feed lists an employee's name/department/designation on their
 * birthday ONLY when employee.hrms_employees.share_birthday is true, and until
 * this control existed nothing could set it, so the birthday block could never
 * show for anyone. This is the opt-in: off by default, the employee's own
 * choice, reversible at any time. It writes through PUT /v1/hrms/me/birthday-
 * sharing, which is self-only (no employee id is sent or accepted). The write
 * is asynchronous (202 -> consumer), so success copy says "saved", and a
 * failure is shown through the shared error standard, never raw server text.
 */

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useFormError } from "@/lib/useFormError";

export function BirthdaySharingToggle({ initialShare }: { initialShare: boolean }) {
  const t = useTranslations("socialFeed");
  const formError = useFormError("birthday-sharing");
  const [share, setShare] = useState(initialShare);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<"on" | "off" | null>(null);
  const [error, setError] = useState("");

  async function change(next: boolean) {
    setBusy(true);
    setError("");
    setSaved(null);
    try {
      const res = await fetch("/api/proxy/v1/hrms/me/birthday-sharing", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ share: next }),
      });
      if (!res.ok) {
        const resolved = await formError.fromResponse(res, "save");
        setError(resolved.message);
        return;
      }
      setShare(next);
      setSaved(next ? "on" : "off");
    } catch (caught) {
      setError(formError.fromException("save", caught).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 14, fontWeight: 600, cursor: busy ? "wait" : "pointer" }}>
        <input
          type="checkbox"
          checked={share}
          disabled={busy}
          onChange={(e) => void change(e.target.checked)}
          style={{ width: 20, height: 20 }}
          aria-describedby="birthday-sharing-help"
        />
        {t("birthdaySharingLabel")}
      </label>
      <p id="birthday-sharing-help" style={{ fontSize: 13, color: "var(--ink2)", margin: 0 }}>
        {t("birthdaySharingHelp")}
      </p>
      <p aria-live="polite" style={{ fontSize: 13, color: "var(--good)", margin: 0, minHeight: 18 }}>
        {saved === "on" ? t("birthdaySharingSavedOn") : saved === "off" ? t("birthdaySharingSavedOff") : ""}
      </p>
      {error ? (
        <p role="alert" style={{ fontSize: 13, color: "var(--bad)", margin: 0 }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
