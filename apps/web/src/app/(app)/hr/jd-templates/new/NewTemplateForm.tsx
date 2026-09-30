"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button, Field, Input, Textarea, ConfirmDialog } from "../../../../_components/ds";

// GAP-HR-JD-TEMPLATES-DETAIL-05 / NEW-04: labels now match the list page's
// own filter-chip wording exactly (jdTemplates.filter* -- "Volunteer" not
// "Volunteer Role", "Regular" not "Regular Position") via new
// jdTemplateNew.type* keys carrying the identical English text, so a
// template's type reads the same everywhere it's shown.
const VACANCY_TYPE_VALUES = ["regular", "internship", "apprenticeship", "volunteership", "contractual", "deputation"] as const;

function typeLabels(t: ReturnType<typeof useTranslations>): Record<(typeof VACANCY_TYPE_VALUES)[number], string> {
  return {
    regular: t("type_regular"),
    internship: t("type_internship"),
    apprenticeship: t("type_apprenticeship"),
    volunteership: t("type_volunteership"),
    contractual: t("type_contractual"),
    deputation: t("type_deputation"),
  };
}

// Mirrors services/hrms-service/src/modules/recruitment/validators.ts's
// createJdTemplateBody exactly (GAP-HR-JD-TEMPLATES-DETAIL-02/NEW-02).
const LIMITS = {
  name: 200,
  description: 5000,
  qualification: 500,
  payRange: 120,
  selectionProcess: 3000,
  tag: 60,
  tagsCount: 10,
  doc: 200,
  docsCount: 30,
};

type TemplateResponse = {
  name?: string;
  vacancyType?: string;
  description?: string;
  qualification?: string;
  payRange?: string;
  selectionProcess?: string;
  tags?: string[];
  requiredDocuments?: string[];
};

/**
 * HIGH fix: the JD Template Library's "Edit" link (jd-templates/page.tsx ->
 * /hr/jd-templates/{id}) was a dead 404 -- no [id]/page.tsx existed. Rather
 * than building a separate edit UI from scratch, this same create form now
 * takes an optional `templateId`: absent, it behaves exactly as before
 * (POST, create); present, it loads the existing template and PATCHes it
 * (updateJdTemplateBody in jd-template-routes.ts already accepts every field
 * this form collects, via createJdTemplateBody.partial()). See
 * jd-templates/[id]/page.tsx for the new edit route that renders this in
 * edit mode.
 */
export function NewTemplateForm({ templateId }: { templateId?: string }) {
  const t = useTranslations("jdTemplateNew");
  const tAction = useTranslations("action");
  const TYPE_LABEL = typeLabels(t);
  const router = useRouter();
  const isEdit = !!templateId;
  const [name, setName] = useState("");
  const [vacancyType, setVacancyType] = useState("regular");
  const [description, setDescription] = useState("");
  const [qualification, setQualification] = useState("");
  const [payRange, setPayRange] = useState("");
  const [selectionProcess, setSelectionProcess] = useState("");
  const [tags, setTags] = useState("");
  // GAP-HR-JD-TEMPLATES-DETAIL-03/NEW-03: requiredDocuments is accepted by
  // createJdTemplateBody/updateJdTemplateBody and consumed by
  // hr/recruitment/new's NewJobOpeningForm (pre-fills a job opening's
  // required-documents list from the template), but this form never
  // collected it -- a template could never carry it. Same comma-separated
  // text-to-array convention as the existing `tags` field above, not a new
  // input pattern. `eligibility` is deliberately left out: it has no agreed
  // UI shape yet (a free-form JSON record) -- see this ticket's own fix
  // steps ("decide eligibility UI shape... otherwise hide").
  const [requiredDocuments, setRequiredDocuments] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [message, setMessage] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(isEdit);
  const [loadError, setLoadError] = useState<"not_found" | "other" | null>(null);
  const [dirty, setDirty] = useState(false);
  const [confirmingCancel, setConfirmingCancel] = useState(false);

  useEffect(() => {
    if (!templateId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/proxy/v1/hrms/jd-templates/${templateId}`);
        if (!res.ok) {
          if (!cancelled) setLoadError(res.status === 404 ? "not_found" : "other");
          return;
        }
        const tmpl = (await res.json()) as TemplateResponse;
        if (cancelled) return;
        setName(tmpl.name ?? "");
        setVacancyType(tmpl.vacancyType ?? "regular");
        setDescription(tmpl.description ?? "");
        setQualification(tmpl.qualification ?? "");
        setPayRange(tmpl.payRange ?? "");
        setSelectionProcess(tmpl.selectionProcess ?? "");
        setTags((tmpl.tags ?? []).join(", "));
        setRequiredDocuments((tmpl.requiredDocuments ?? []).join(", "));
      } catch {
        if (!cancelled) setLoadError("other");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [templateId]);

  // GAP-HR-JD-TEMPLATES-DETAIL-06/NEW-05: warn on an actual browser-level
  // navigation (reload/close tab) while there are unsaved edits -- the
  // in-app Cancel link below is handled separately (a confirm dialog, not
  // this native prompt) since it's a same-app client navigation.
  useEffect(() => {
    if (!dirty) return;
    function handler(e: BeforeUnloadEvent) {
      e.preventDefault();
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  function markDirty() {
    if (!dirty) setDirty(true);
  }

  function tagsFromInput(value: string, maxCount: number, maxLen: number): string[] | undefined {
    if (!value.trim()) return undefined;
    return value.split(",").map((v) => v.trim()).filter(Boolean).slice(0, maxCount).map((v) => v.slice(0, maxLen));
  }

  function validate(): string | null {
    if (!name.trim()) return t("nameRequired");
    if (name.trim().length > LIMITS.name) return t("nameTooLong", { max: LIMITS.name });
    if (description.trim().length > LIMITS.description) return t("descriptionTooLong", { max: LIMITS.description });
    if (qualification.trim().length > LIMITS.qualification) return t("qualificationTooLong", { max: LIMITS.qualification });
    if (payRange.trim().length > LIMITS.payRange) return t("payRangeTooLong", { max: LIMITS.payRange });
    if (selectionProcess.trim().length > LIMITS.selectionProcess) return t("selectionProcessTooLong", { max: LIMITS.selectionProcess });
    return null;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFieldErrors({});
    const validationMessage = validate();
    if (validationMessage) {
      setStatus("error");
      setMessage(validationMessage);
      return;
    }

    setStatus("submitting");
    setMessage("");

    try {
      const res = await fetch(
        isEdit ? `/api/proxy/v1/hrms/jd-templates/${templateId}` : "/api/proxy/v1/hrms/jd-templates",
        {
          method: isEdit ? "PATCH" : "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: name.trim(),
            vacancyType,
            description: description.trim() || undefined,
            qualification: qualification.trim() || undefined,
            payRange: payRange.trim() || undefined,
            selectionProcess: selectionProcess.trim() || undefined,
            tags: tagsFromInput(tags, LIMITS.tagsCount, LIMITS.tag),
            requiredDocuments: tagsFromInput(requiredDocuments, LIMITS.docsCount, LIMITS.doc),
          }),
        },
      );

      if (!res.ok) {
        const err = (await res.json().catch(() => ({ message: t("saveFailedGeneric") }))) as {
          message?: string;
          fieldErrors?: { field: string; message: string }[];
        };
        setStatus("error");
        setMessage(err.message ?? (isEdit ? t("updateFailed") : t("createFailed")));
        if (err.fieldErrors?.length) {
          setFieldErrors(Object.fromEntries(err.fieldErrors.map((fe) => [fe.field, fe.message])));
        }
        return;
      }

      // GAP-HR-JD-TEMPLATES-DETAIL-01/NEW-01: both POST and PATCH only
      // publish a queue command (jd-template-routes.ts returns 202/200
      // with status "accepted"; the actual DB write happens later in
      // recruitment/consumer.ts) -- this used to say "successfully" and
      // redirect after a fixed delay regardless, which can outrace the
      // consumer and claims a completion that hasn't happened yet. The
      // copy is now honest about that; router.refresh() after navigating
      // back at least re-fetches the list's server data instead of
      // serving a stale client-cached copy.
      setDirty(false);
      setStatus("success");
      setMessage(isEdit ? t("updateSubmitted") : t("createSubmitted"));
      setTimeout(() => {
        router.push("/hr/jd-templates");
        router.refresh();
      }, 1000);
    } catch {
      setStatus("error");
      setMessage(t("networkError"));
    }
  }

  function handleCancelClick(e: React.MouseEvent) {
    if (dirty) {
      e.preventDefault();
      setConfirmingCancel(true);
    }
  }

  if (loading) {
    return <p style={{ textAlign: "center", color: "var(--mut)", padding: "48px 0" }}>{t("loadingTemplate")}</p>;
  }

  if (loadError) {
    return (
      <div style={{ maxWidth: 640 }}>
        <p role="alert" style={{ margin: 0, padding: "10px 14px", borderRadius: 8, background: "var(--badbg, #fef2f2)", color: "var(--bad, #b91c1c)", fontSize: 13, border: "1px solid var(--badbd, #fecaca)" }}>
          {loadError === "not_found" ? t("loadNotFound") : t("loadOtherError")}
        </p>
        <Link href="/hr/jd-templates" style={{ display: "inline-block", marginTop: 14, padding: "10px 20px", fontSize: 14, fontWeight: 600, color: "var(--ink2, #475569)", background: "var(--bg, #f1f5f9)", borderRadius: 8, textDecoration: "none" }}>
          {t("backToTemplates")}
        </Link>
      </div>
    );
  }

  return (
    <>
      <form onSubmit={handleSubmit} style={{ maxWidth: 640, display: "grid", gap: 18 }}>
        <Field label={t("nameLabel")} required error={fieldErrors.name}>
          <Input
            value={name}
            onChange={(e) => { setName(e.target.value); markDirty(); }}
            placeholder={t("namePlaceholder")}
            maxLength={LIMITS.name}
            required
          />
        </Field>

        <Field label={t("typeLabel")} required>
          <select
            id="tpl-type"
            value={vacancyType}
            onChange={(e) => { setVacancyType(e.target.value); markDirty(); }}
            style={{
              width: "100%", padding: "10px 12px", fontSize: 14, border: "1px solid var(--line, #cbd5e1)",
              borderRadius: 8, boxSizing: "border-box", color: "var(--ink, #0f172a)", background: "var(--panel, #fff)",
            }}
          >
            {VACANCY_TYPE_VALUES.map((v) => (
              <option key={v} value={v}>{TYPE_LABEL[v]}</option>
            ))}
          </select>
        </Field>

        <Field label={t("descriptionLabel")} error={fieldErrors.description}>
          <Textarea
            value={description}
            onChange={(e) => { setDescription(e.target.value); markDirty(); }}
            rows={5}
            placeholder={t("descriptionPlaceholder")}
            maxLength={LIMITS.description}
          />
        </Field>

        <Field label={t("qualificationLabel")} error={fieldErrors.qualification}>
          <Input
            value={qualification}
            onChange={(e) => { setQualification(e.target.value); markDirty(); }}
            placeholder={t("qualificationPlaceholder")}
            maxLength={LIMITS.qualification}
          />
        </Field>

        <Field label={t("payRangeLabel")} error={fieldErrors.payRange}>
          <Input
            value={payRange}
            onChange={(e) => { setPayRange(e.target.value); markDirty(); }}
            placeholder={t("payRangePlaceholder")}
            maxLength={LIMITS.payRange}
          />
        </Field>

        <Field label={t("selectionProcessLabel")} error={fieldErrors.selectionProcess}>
          <Textarea
            value={selectionProcess}
            onChange={(e) => { setSelectionProcess(e.target.value); markDirty(); }}
            rows={3}
            placeholder={t("selectionProcessPlaceholder")}
            maxLength={LIMITS.selectionProcess}
          />
        </Field>

        <Field label={t("requiredDocumentsLabel")}>
          <Input
            value={requiredDocuments}
            onChange={(e) => { setRequiredDocuments(e.target.value); markDirty(); }}
            placeholder={t("requiredDocumentsPlaceholder")}
          />
          <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--mut)" }}>{t("requiredDocumentsHint")}</p>
        </Field>

        <Field label={t("tagsLabel")}>
          <Input
            value={tags}
            onChange={(e) => { setTags(e.target.value); markDirty(); }}
            placeholder={t("tagsPlaceholder")}
          />
          <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--mut)" }}>{t("tagsHint")}</p>
        </Field>

        {status === "error" && (
          <p role="alert" style={{ margin: 0, padding: "10px 14px", borderRadius: 8, background: "var(--badbg, #fef2f2)", color: "var(--bad, #b91c1c)", fontSize: 13, border: "1px solid var(--badbd, #fecaca)" }}>
            {message}
          </p>
        )}
        {status === "success" && (
          <p style={{ margin: 0, padding: "10px 14px", borderRadius: 8, background: "var(--goodbg, #f0fdf4)", color: "var(--good, #15803d)", fontSize: 13, border: "1px solid var(--goodbd, #bbf7d0)" }}>
            {message}
          </p>
        )}

        <div style={{ display: "flex", gap: 10 }}>
          <Button type="submit" variant="primary" disabled={status === "submitting" || status === "success"}>
            {status === "submitting" ? t("saving") : isEdit ? t("saveChanges") : t("saveTemplate")}
          </Button>
          <Link
            href="/hr/jd-templates"
            onClick={handleCancelClick}
            style={{ padding: "10px 20px", fontSize: 14, fontWeight: 600, color: "var(--ink2, #475569)", background: "var(--bg, #f1f5f9)", borderRadius: 8, textDecoration: "none" }}
          >
            {tAction("cancel")}
          </Link>
        </div>
      </form>

      {/* GAP-HR-JD-TEMPLATES-DETAIL-06/NEW-05: Cancel used to be a plain
          full-page-reload <a> with no dirty-form guard at all -- an
          accidental click discarded whatever had been typed. Only prompts
          when there are actually unsaved edits (see `dirty`/markDirty
          above); a clean form still navigates immediately. */}
      <ConfirmDialog
        open={confirmingCancel}
        title={t("discardChangesTitle")}
        description={t("discardChangesMessage")}
        confirmLabel={t("discardChangesConfirm")}
        danger
        onConfirm={() => {
          setConfirmingCancel(false);
          setDirty(false);
          router.push("/hr/jd-templates");
        }}
        onCancel={() => setConfirmingCancel(false)}
      />
    </>
  );
}
