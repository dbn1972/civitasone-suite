"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Card } from "../../../../_components/ds";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KNOWN_ERRORS = ["LOGIN_ALREADY_LINKED", "LOGIN_NOT_FOUND", "LOGIN_NOT_ACTIVE", "EMPLOYEE_EXITED", "IDENTITY_UNAVAILABLE", "FORBIDDEN", "NOT_FOUND"] as const;
type KnownError = (typeof KNOWN_ERRORS)[number];

/**
 * FQ14: link (or unlink) the login an employee record belongs to, so that
 * person's self-service (leave, attendance, claims, approvals) resolves to
 * this record. Calls PATCH /v1/hrms/employees/:id/login-link, which is
 * restricted to EMPLOYEE_LOGIN_LINK_ROLES (hr_admin / super_admin) and
 * audited with the reason given here. The page renders this card only for
 * those roles (see page.tsx), never for hr_officer.
 */
export function EmployeeLoginLinkCard({ employeeId }: { employeeId: string }) {
  const t = useTranslations("employeeLoginLink");
  const router = useRouter();
  const [userId, setUserId] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  async function submit(target: string | null) {
    setMessage(null);
    if (target !== null && !UUID_RE.test(target.trim())) {
      setMessage({ kind: "error", text: t("invalidUserId") });
      return;
    }
    if (reason.trim().length < 3) {
      setMessage({ kind: "error", text: t("reasonRequired") });
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/proxy/v1/hrms/employees/${employeeId}/login-link`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: target === null ? null : target.trim(), reason: reason.trim() }),
      });
      if (res.ok) {
        setMessage({ kind: "ok", text: target === null ? t("unlinked") : t("linked") });
        setUserId("");
        setReason("");
        router.refresh();
        return;
      }
      const body = (await res.json().catch(() => null)) as { code?: string } | null;
      const code = body?.code;
      setMessage({
        kind: "error",
        text: code && (KNOWN_ERRORS as readonly string[]).includes(code) ? t(`error.${code as KnownError}`) : t("error.generic"),
      });
    } catch {
      setMessage({ kind: "error", text: t("error.generic") });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title={t("title")} padding>
      <p style={{ margin: "0 0 10px", color: "var(--mut)", fontSize: 13 }}>{t("help")}</p>
      <div className="fields">
        <label className="fld" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span className="l">{t("userIdLabel")}</span>
          <input className="inp" value={userId} onChange={(e) => setUserId(e.target.value)} autoComplete="off" style={{ minHeight: 44 }} />
        </label>
        <label className="fld" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span className="l">{t("reasonLabel")}</span>
          <input className="inp" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} style={{ minHeight: 44 }} />
        </label>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
        <button type="button" className="btn" disabled={busy} onClick={() => void submit(userId)} style={{ minHeight: 44 }}>
          {t("linkButton")}
        </button>
        <button type="button" className="btn ghost" disabled={busy} onClick={() => void submit(null)} style={{ minHeight: 44 }}>
          {t("unlinkButton")}
        </button>
      </div>
      {message && (
        <p role={message.kind === "error" ? "alert" : "status"} style={{ margin: "10px 0 0", fontSize: 13 }}>{message.text}</p>
      )}
    </Card>
  );
}
