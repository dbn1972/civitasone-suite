"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { AcceptedNotice, Button } from "@/app/_components/ds";
import { Field } from "@/app/_components/ds/Field";
import { Input } from "@/app/_components/ds/Input";
import { useAcceptedWrite } from "@/lib/useAcceptedWrite";
import { useFormError } from "@/lib/useFormError";
import { listContainsId } from "@/lib/listContainsId";

const FRAMEWORKS_URL = "/api/proxy/v1/hrms/competency/frameworks";

/** The id the POST handed back; null if the body was unreadable (then nothing can be confirmed). */
type CreatedFramework = { id: string | null };

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
 * The write is NOT synchronous: the route validates, publishes the insert to
 * the F3 write queue (publishF3Write) and answers 201 `{ id }` straight away;
 * f3-consumer.ts inserts the row afterwards. A bare `router.refresh()` after
 * the 201 can therefore re-render a list that does not yet contain the new
 * framework (the earlier version of this component assumed otherwise). So the
 * flow follows the shared SF-15 pattern: say "Submitted", poll the
 * frameworks list (the resource's own GET -- there is no command-status
 * endpoint) until the returned id appears, then refresh the page data; if it
 * has not appeared when the bounded poll runs out, say "still processing"
 * with a manual Refresh instead of guessing.
 */
export function AddFrameworkAction() {
  const t = useTranslations("competency");
  const tAction = useTranslations("action");
  const formError = useFormError("competency framework");
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "error">("idle");
  const [message, setMessage] = useState("");

  const accepted = useAcceptedWrite<CreatedFramework, unknown>({
    poll: async () => {
      const res = await fetch(FRAMEWORKS_URL, { cache: "no-store" });
      if (!res.ok) throw new Error("frameworks list not readable yet");
      return res.json() as Promise<unknown>;
    },
    isDone: (polled, created) => created.id !== null && listContainsId(polled, created.id),
    maxAttempts: 5,
    initialDelayMs: 500,
  });

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
      const res = await fetch(FRAMEWORKS_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const resolved = await formError.fromResponse(res, "save");
        setStatus("error");
        setMessage(resolved.message || t("frameworkSaveFailed"));
        return;
      }
      const body = (await res.json().catch(() => null)) as { id?: unknown } | null;
      const id = typeof body?.id === "string" && body.id ? body.id : null;
      setOpen(false);
      setName("");
      setDescription("");
      setStatus("idle");
      void accepted.accept({ id });
    } catch (caught) {
      setStatus("error");
      setMessage(formError.fromException("save", caught).message || t("networkError"));
    }
  }

  const busy = status === "submitting";
  const notice =
    accepted.phase !== "idle" ? (
      <AcceptedNotice
        {...accepted.noticeProps}
        message={t("frameworkSubmitted")}
        labels={{ timedOut: t("frameworkStillProcessing") }}
      />
    ) : null;

  if (!open) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
        {/* Held while the previous framework is still being confirmed, so an
            impatient second click cannot queue a duplicate. */}
        <Button size="sm" onClick={() => setOpen(true)} disabled={accepted.isBusy}>
          {t("addFramework")}
        </Button>
        {notice}
      </div>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        void handleSubmit(e);
      }}
      style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 260, padding: "4px 0" }}
    >
      <Field label={t("frameworkNameLabel")} required>
        <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={256} disabled={busy} />
      </Field>
      <Field label={t("frameworkDescriptionLabel")}>
        <Input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} disabled={busy} />
      </Field>
      {status === "error" && (
        <p role="alert" style={{ margin: 0, fontSize: 12, color: "var(--bad)" }}>
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
      {notice}
    </form>
  );
}
