"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { AcceptedNotice, Button, Card, Field, Input } from "../../../../_components/ds";
import { useAcceptedWrite } from "@/lib/useAcceptedWrite";
import { browserJson } from "@/lib/api/browserClient";

/** Section 8 G2: create an empty CTC template (POST /v1/payroll/ctc-templates, 202); components are added on its page. */
export function CreateTemplateForm() {
  const t = useTranslations("payComponents");
  const router = useRouter();
  const accepted = useAcceptedWrite();
  const [name, setName] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const nameId = useId();
  const dateId = useId();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setDone(false);
    if (name.trim().length < 1 || name.length > 128) { setError(t("errName")); return; }
    if (effectiveFrom && !/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom)) { setError(t("errDate")); return; }
    setBusy(true);
    setError(null);
    try {
      await browserJson("v1/payroll/ctc-templates", {
        method: "POST",
        body: JSON.stringify({ name: name.trim(), ...(effectiveFrom ? { effectiveFrom } : {}) }),
      });
      setName("");
      setEffectiveFrom("");
      setDone(true);
      router.refresh();
      void accepted.accept();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("networkError"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form noValidate onSubmit={submit} style={{ marginBottom: 16 }}>
      <AcceptedNotice {...accepted.noticeProps} />
      <Card title={t("templateFormTitle")} padding>
        <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))" }}>
          <Field id={nameId} label={t("templateNameLabel")} required>
            <Input id={nameId} value={name} maxLength={128} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field id={dateId} label={t("templateEffectiveLabel")} hint={t("templateEffectiveHint")}>
            <Input id={dateId} type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} />
          </Field>
        </div>
        <div style={{ marginTop: 12 }}>
          <Button type="submit" disabled={busy} style={{ minHeight: 44 }}>{t("createTemplateBtn")}</Button>
        </div>
        {error && <p role="alert" className="pill bad" style={{ width: "fit-content", marginTop: 12 }}>{error}</p>}
        {done && !error && <p role="status" className="pill good" style={{ width: "fit-content", marginTop: 12 }}>{t("templateCreatedMessage")}</p>}
      </Card>
    </form>
  );
}
