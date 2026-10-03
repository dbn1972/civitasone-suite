"use client";

/**
 * GAP-HR-LEAVE-APPLY-05: the per-tenant switch for half-day Casual Leave and
 * short leave. Both default OFF (whole days only); turning one on lets
 * employees pick it on the Apply Leave form. Rendered only for the leave
 * policy admin roles (page.tsx), and PUT /v1/hrms/leave-config re-checks the
 * role and audits the change server-side.
 */
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Button, Card } from "../../../_components/ds";
import { useFormError } from "@/lib/useFormError";
import { parseLeaveConfig, NO_PART_DAY_CONFIG, type LeaveTenantConfig } from "../leave/apply/dayPart";

export default function HalfDayLeaveSettings() {
  const t = useTranslations("leavePolicies");
  const [saved, setSaved] = useState<LeaveTenantConfig>(NO_PART_DAY_CONFIG);
  const [draft, setDraft] = useState<LeaveTenantConfig>(NO_PART_DAY_CONFIG);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const err = useFormError("leave settings");

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/proxy/v1/hrms/leave-config", { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        if (!body) return;
        const cfg = parseLeaveConfig(body);
        setSaved(cfg);
        setDraft(cfg);
      })
      .catch(() => { /* leave the safe OFF defaults */ });
    return () => controller.abort();
  }, []);

  const dirty = draft.halfDayEnabled !== saved.halfDayEnabled || draft.shortLeaveEnabled !== saved.shortLeaveEnabled;

  async function save() {
    setBusy(true);
    setNote("");
    err.clear();
    try {
      const res = await fetch("/api/proxy/v1/hrms/leave-config", {
        method: "PUT",
        headers: { "content-type": "application/json", "x-idempotency-key": crypto.randomUUID() },
        body: JSON.stringify(draft),
      });
      if (!res.ok) {
        await err.fromResponse(res, "save");
        return;
      }
      setSaved(draft);
      setNote(t("halfDaySaved"));
    } catch (caught) {
      err.fromException("save", caught);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title={t("halfDayTitle")}>
      <div className="pad" style={{ display: "grid", gap: 10 }}>
        <p style={{ margin: 0, fontSize: 13, color: "var(--ink2)" }}>{t("halfDayHelp")}</p>
        <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 14 }}>
          <input
            type="checkbox"
            checked={draft.halfDayEnabled}
            onChange={(e) => setDraft({ ...draft, halfDayEnabled: e.target.checked })}
          />
          {t("halfDayLabel")}
        </label>
        <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 14 }}>
          <input
            type="checkbox"
            checked={draft.shortLeaveEnabled}
            onChange={(e) => setDraft({ ...draft, shortLeaveEnabled: e.target.checked })}
          />
          {t("shortLeaveLabel")}
        </label>
        {err.message && <p role="alert" style={{ margin: 0, fontSize: 13, color: "var(--bad, #b91c1c)" }}>{err.message}</p>}
        {note && <p role="status" style={{ margin: 0, fontSize: 13, color: "var(--good, #15803d)" }}>{note}</p>}
        <div>
          <Button onClick={() => void save()} disabled={!dirty || busy}>{busy ? t("halfDaySaving") : t("halfDaySave")}</Button>
        </div>
      </div>
    </Card>
  );
}
