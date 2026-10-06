"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { useFormError } from "@/lib/useFormError";
import { useRouter } from "next/navigation";
import { DataTable, StatusPill, Button, ConfirmDialog } from "../../../_components/ds";
import { LeadFormEditor } from "../../../_components/crm/LeadFormEditor";
import type { CRMLeadCaptureForm } from "@civitasone/types";
import { setLeadFormEnabled, setLeadFormConsent } from "@/lib/crm/leadForms";
import {
  formHealth,
  originSummary,
  originTitle,
  publicSubmitPath,
  absoluteSubmitUrl,
  embedSnippet,
  HEALTH_LABEL,
  type FormHealth,
} from "./leadForms";

type Row = {
  id: string;
  name: string;
  health: string;
  healthLabel: string;
  submitUrl: string;
  origins: string;
  originsTitle: string;
  source: string;
  rate: string;
  form: CRMLeadCaptureForm;
};

/**
 * GAP-CRM-LEAD-FORMS-05: copy the absolute public submit URL (built from the
 * live browser origin, not the gateway-relative path) and reveal an embeddable
 * HTML snippet. Uses navigator.clipboard like the existing api-keys screen.
 */
function SubmitUrlCell({ form }: { form: CRMLeadCaptureForm }) {
  const [copied, setCopied] = useState(false);
  const [snippetCopied, setSnippetCopied] = useState(false);
  const [showEmbed, setShowEmbed] = useState(false);

  function origin(): string {
    return typeof window !== "undefined" ? window.location.origin : "";
  }

  async function copyUrl() {
    try {
      await navigator.clipboard.writeText(absoluteSubmitUrl(origin(), form.formKey));
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  async function copySnippet() {
    try {
      await navigator.clipboard.writeText(embedSnippet(origin(), form.formKey));
      setSnippetCopied(true);
    } catch {
      setSnippetCopied(false);
    }
  }

  return (
    <span style={{ display: "inline-flex", flexDirection: "column", gap: 4, maxWidth: 320 }}>
      <code style={{ overflowWrap: "anywhere", fontSize: 12 }}>{publicSubmitPath(form.formKey)}</code>
      <span style={{ display: "inline-flex", gap: 6, flexWrap: "wrap" }}>
        <Button type="button" variant="ghost" size="sm" onClick={() => void copyUrl()}>
          {copied ? "Copied ✓" : "Copy URL"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-expanded={showEmbed}
          onClick={() => setShowEmbed((v) => !v)}
        >
          Embed snippet
        </Button>
      </span>
      {showEmbed ? (
        <span style={{ display: "inline-flex", flexDirection: "column", gap: 4 }}>
          <code
            style={{
              display: "block",
              whiteSpace: "pre-wrap",
              overflowWrap: "anywhere",
              background: "var(--panel)",
              border: "1px solid var(--line)",
              borderRadius: "var(--r)",
              padding: 8,
              fontSize: 11,
            }}
          >
            {embedSnippet(origin(), form.formKey)}
          </code>
          <Button type="button" variant="ghost" size="sm" onClick={() => void copySnippet()}>
            {snippetCopied ? "Copied ✓" : "Copy snippet"}
          </Button>
        </span>
      ) : null}
    </span>
  );
}

export function LeadFormsTable({ rows }: { rows: CRMLeadCaptureForm[] }) {
  const router = useRouter();
  const t = useTranslations("crmLeadFormsTable");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<CRMLeadCaptureForm | null>(null);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const formError = useFormError("lead form");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmConsent, setConfirmConsent] = useState<CRMLeadCaptureForm | null>(null);

  function openRegister() {
    setEditing(null);
    setNewKey(null);
    setMessage("");
    setError("");
    setEditorOpen(true);
  }
  function openEdit(form: CRMLeadCaptureForm) {
    setEditing(form);
    setMessage("");
    setError("");
    setEditorOpen(true);
  }

  function onSaved(result: { formKey?: string }) {
    setEditorOpen(false);
    setError("");
    if (result.formKey) {
      setNewKey(result.formKey);
      setMessage("");
    } else {
      setMessage(t("saved"));
    }
    router.refresh();
  }

  async function togglePause(form: CRMLeadCaptureForm) {
    setBusyId(form.id);
    setError("");
    try {
      await setLeadFormEnabled(form.id, !form.enabled);
      setMessage(form.enabled ? t("paused") : t("resumed"));
      router.refresh();
    } catch (e) {
      setError(formError.fromException("save", e).message);
    } finally {
      setBusyId(null);
    }
  }

  async function fixConsent(form: CRMLeadCaptureForm) {
    setBusyId(form.id);
    setConfirmConsent(null);
    setError("");
    try {
      await setLeadFormConsent(form.id, true);
      setMessage(t("consentFixed"));
      router.refresh();
    } catch (e) {
      setError(formError.fromException("save", e).message);
    } finally {
      setBusyId(null);
    }
  }

  const tableRows: Row[] = rows.map((form) => {
    const health = formHealth(form);
    return {
      id: form.id,
      name: form.name,
      health,
      healthLabel: HEALTH_LABEL[health] ?? health,
      submitUrl: publicSubmitPath(form.formKey),
      origins: originSummary(form.allowedOrigins, {
        any: t("anyOrigin"),
        more: (count) => t("originsMore", { count }),
      }),
      originsTitle: originTitle(form.allowedOrigins),
      source: form.defaultLeadSource ?? "—",
      rate: t("ratePerMinute", { rate: form.maxPerMinute }),
      form,
    };
  });

  return (
    <>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
        <Button type="button" onClick={openRegister}>{t("registerForm")}</Button>
      </div>

      {message ? (
        <p role="status" aria-live="polite" style={{ fontSize: 13, color: "#047857", margin: "0 0 12px" }}>{message}</p>
      ) : null}
      {error ? (
        <p role="alert" aria-live="assertive" style={{ fontSize: 13, color: "#b42318", margin: "0 0 12px" }}>{error}</p>
      ) : null}

      {newKey ? (
        <p role="status" aria-live="polite" style={{ fontSize: 13, color: "#047857", margin: "0 0 12px" }}>
          {t.rich("registered", {
            path: publicSubmitPath(newKey),
            code: (chunks) => <code>{chunks}</code>,
          })}
        </p>
      ) : null}

      <DataTable<Row>
        columns={[
          { key: "name", label: t("colForm") },
          {
            key: "health",
            label: t("colStatus"),
            // GAP-CRM-LEAD-FORMS-03: show the human label, never the raw
            // "unlawful" enum, and give it an explicit tone (consent gap = bad)
            // rather than StatusPill's neutral "info" fallback for an unmapped word.
            render: (row) => {
              const h = row.health as FormHealth;
              const tone = h === "unlawful" ? "bad" : h === "paused" ? "mut" : "good";
              return <StatusPill status={row.health} label={h === "live" || h === "paused" || h === "unlawful" ? t(`health_${h}`) : row.health} variant={tone} />;
            },
          },
          { key: "submitUrl", label: t("colSubmitUrl"), render: (row) => <SubmitUrlCell form={row.form} /> },
          {
            key: "origins",
            label: t("colOrigins"),
            // GAP-CRM-LEAD-FORMS-05: the collapsed "first +N more" summary is
            // backed by a title tooltip listing every allowed origin.
            render: (row) => <span title={row.originsTitle}>{row.origins}</span>,
          },
          { key: "source", label: t("colSource") },
          { key: "rate", label: t("colRate"), align: "right" },
          {
            key: "id",
            label: t("colActions"),
            render: (row) => (
              <span style={{ display: "inline-flex", gap: 6, flexWrap: "wrap" }}>
                <Button type="button" variant="ghost" size="sm" onClick={() => openEdit(row.form)} disabled={busyId === row.id}>
                  {t("edit")}
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => void togglePause(row.form)} disabled={busyId === row.id}>
                  {row.form.enabled ? t("pause") : t("enable")}
                </Button>
                {row.health === "unlawful" ? (
                  <Button type="button" variant="danger" size="sm" onClick={() => setConfirmConsent(row.form)} disabled={busyId === row.id}>
                    {t("fixConsent")}
                  </Button>
                ) : null}
              </span>
            ),
          },
        ]}
        rows={tableRows}
        sortable
        filterable
        filterPlaceholder="Filter by form…"
        filterKeys={["name", "healthLabel", "source", "origins"]}
        exportable
        exportFilename="crm-lead-capture-forms"
        exportConfirm={{
          title: t("exportTitle"),
          description: t("exportDescription"),
          confirmLabel: t("exportConfirmLabel"),
        }}
        emptyIcon="🌐"
        emptyTitle={t("emptyTitle")}
        emptyMessage={t("emptyMessage")}
      />

      <LeadFormEditor open={editorOpen} form={editing} onClose={() => setEditorOpen(false)} onSaved={onSaved} />

      <ConfirmDialog
        open={confirmConsent !== null}
        title={confirmConsent ? t("confirmTitle", { name: confirmConsent.name }) : ""}
        description={t("confirmDescription")}
        confirmLabel={t("confirmLabel")}
        busy={confirmConsent ? busyId === confirmConsent.id : false}
        onCancel={() => setConfirmConsent(null)}
        onConfirm={() => confirmConsent && void fixConsent(confirmConsent)}
      />
    </>
  );
}
