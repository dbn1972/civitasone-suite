"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/app/_components/ds";
import { Field } from "@/app/_components/ds/Field";
import { Input } from "@/app/_components/ds/Input";

/**
 * GAP-HR-COMPETENCY-02: the frameworks list had no create action anywhere in
 * the UI even though POST /v1/hrms/competency/frameworks exists and is
 * HR-only (competency/routes.ts HR_ROLES) -- an hr_admin/hr_officer/
 * super_admin viewer had no way to add a framework except by calling the API
 * directly, and the empty-state copy ("Add a framework to begin mapping role
 * requirements") had no corresponding action. Rendered only for HR roles
 * (see competency/page.tsx's canManage), mirroring competency/routes.ts's own
 * HR_ROLES guard exactly.
 *
 * POST is fire-and-forget from this component's perspective: the route
 * returns 201 synchronously (unlike jd-templates' queue-backed 202 writes),
 * so a plain router.refresh() after a 2xx is sufficient -- no polling needed.
 */
export function AddFrameworkAction() {
  const t = useTranslations("competency");
  const tAction = useTranslations("action");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "error">("idle");
  const [message, setMessage] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setStatus("error");
      setMessage(t("frameworkNameRequired"));
      return;
    }
    setStatus("submitting");
    setMessage("");
    try {
      const res = await fetch("/api/proxy/v1/hrms/competency/frameworks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({ message: t("frameworkSaveFailed") }))) as { message?: string };
        setStatus("error");
        setMessage(err.message ?? t("frameworkSaveFailed"));
        return;
      }
      setOpen(false);
      setName("");
      setDescription("");
      setStatus("idle");
      router.refresh();
    } catch {
      setStatus("error");
      setMessage(t("networkError"));
    }
  }

  if (!open) {
    return (
      <Button size="sm" onClick={() => setOpen(true)}>
        {t("addFramework")}
      </Button>
    );
  }

  const busy = status === "submitting";

  return (
    <form
      onSubmit={handleSubmit}
      style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 260, padding: "4px 0" }}
    >
      <Field label={t("frameworkNameLabel")} required>
        <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={256} disabled={busy} />
      </Field>
      <Field label={t("frameworkDescriptionLabel")}>
        <Input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} disabled={busy} />
      </Field>
      {status === "error" && (
        <p role="alert" style={{ margin: 0, fontSize: 12, color: "var(--bad, #b91c1c)" }}>
          {message}
        </p>
      )}
      <div style={{ display: "flex", gap: 8 }}>
        <Button type="submit" size="sm" disabled={busy}>
          {busy ? t("saving") : tAction("save")}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={() => {
            setOpen(false);
            setStatus("idle");
            setMessage("");
          }}
        >
          {tAction("cancel")}
        </Button>
      </div>
    </form>
  );
}
