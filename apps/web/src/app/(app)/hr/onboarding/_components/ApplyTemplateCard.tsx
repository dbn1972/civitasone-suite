"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useFormError } from "@/lib/useFormError";
import { Button, AcceptedNotice, Field, Select } from "../../../../_components/ds";
import { useAcceptedWrite } from "@/lib/useAcceptedWrite";

type TemplateOption = { id: string; name: string; stepCount: number; isDefault: boolean };

/**
 * GAP-HR-ONBOARDING-02: start (or top up) an employee's onboarding from a
 * template. Calls POST /v1/hrms/employees/:id/onboarding/apply-template, which
 * is idempotent per task title -- applying twice never duplicates tasks, so
 * the UI can honestly offer it again on a joinee who already has some.
 */
export function ApplyTemplateCard({ employeeId, hasTasks }: { employeeId: string; hasTasks: boolean }) {
  const t = useTranslations("onboardingTemplate");
  const accepted = useAcceptedWrite();
  const formError = useFormError("onboarding template");
  const [templates, setTemplates] = useState<TemplateOption[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [templateId, setTemplateId] = useState("default");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const idemKey = useRef<string>(typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Date.now()));

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/proxy/v1/hrms/onboarding/templates", { signal: controller.signal })
      .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
      .then((b: { data?: TemplateOption[] }) => setTemplates(b.data ?? []))
      .catch((e) => { if (!(e instanceof Error && e.name === "AbortError")) setLoadFailed(true); });
    return () => controller.abort();
  }, []);

  async function apply() {
    if (busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const res = await fetch(`/api/proxy/v1/hrms/employees/${employeeId}/onboarding/apply-template`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-idempotency-key": `${idemKey.current}:${templateId}` },
        body: JSON.stringify({ templateId }),
      });
      if (!res.ok) { setError((await formError.fromResponse(res, "save")).message); return; }
      const body = (await res.json()) as { stepCount?: number };
      setNotice(t("applied", { count: body.stepCount ?? 0 }));
      // Async write (queue) -- refresh shortly so the new tasks actually show.
      void accepted.accept();
    } catch (caught) {
      setError(formError.fromException("save", caught).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ marginTop: 16, textAlign: "left", maxWidth: 420, marginInline: "auto" }}>
      <AcceptedNotice {...accepted.noticeProps} />
      <h3 style={{ fontSize: 14, margin: "0 0 4px" }}>{hasTasks ? t("titleTopUp") : t("title")}</h3>
      <p style={{ fontSize: 12, color: "var(--mut)", margin: "0 0 8px" }}>{hasTasks ? t("hintTopUp") : t("hint")}</p>
      {loadFailed ? (
        <p role="alert" style={{ fontSize: 12, color: "var(--bad)" }}>{t("loadFailed")}</p>
      ) : (
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <Field label={t("templateLabel")} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <Select value={templateId} onChange={(e) => setTemplateId(e.target.value)} disabled={!templates || busy}
              style={{ width: "auto", minWidth: 220 }}>
              {(templates ?? [{ id: "default", name: t("defaultTemplate"), stepCount: 0, isDefault: true }]).map((tpl) => (
                <option key={tpl.id} value={tpl.id}>{tpl.name}{tpl.stepCount ? ` (${t("stepCount", { count: tpl.stepCount })})` : ""}</option>
              ))}
            </Select>
          </Field>
          <Button type="button" onClick={() => void apply()} disabled={busy || !templates}>{busy ? t("applying") : t("apply")}</Button>
        </div>
      )}
      {notice ? <p role="status" style={{ margin: "8px 0 0", fontSize: 12, color: "var(--good)", fontWeight: 500 }}>{notice}</p> : null}
      {error ? <p role="alert" style={{ margin: "8px 0 0", fontSize: 12, color: "var(--bad)", fontWeight: 500 }}>{error}</p> : null}
    </div>
  );
}
