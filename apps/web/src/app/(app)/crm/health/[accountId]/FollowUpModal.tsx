"use client";

/**
 * FollowUpModal — Account Health detail quick action (S19.8).
 *
 * Opens a modal pre-filled with the account ID and a default service
 * request subject, then POSTs to /api/v1/crm/service-requests.
 * Redirects to the new SR on success.
 */
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useFormError } from "@/lib/useFormError";
import { Button, Field, Input, Modal, Select, Textarea } from "@/app/_components/ds";
import { validateFollowUp, type FollowUpErrors } from "./followUpSchema";

const DIALOG: React.CSSProperties = {
  padding: 0,
};

interface Props {
  accountId: string;
  /**
   * GAP-CRM-HEALTH-ACCOUNTID-01: the human-readable account name, resolved by
   * the server page from crm-service. Shown in the dialog header so a clerk can
   * confirm the target before creating a service request, instead of the raw
   * UUID the dialog used to print. Optional: falls back to the id when unknown.
   */
  accountName?: string | null;
  onClose?: () => void;
  /**
   * GAP-CRM-HEALTH-05: open the dialog on mount — used when the watchlist's
   * per-row "Log follow-up" link deep-links here with ?followUp=1, so the
   * clerk lands straight in the form prefilled with this account.
   */
  defaultOpen?: boolean;
}

export function FollowUpModal({ accountId, accountName, onClose, defaultOpen = false }: Props) {
  const t = useTranslations("crmFollowUpModal");
  const router = useRouter();
  const [open, setOpen] = useState(defaultOpen);
  const [saving, setSaving] = useState(false);
  const formError = useFormError("service request");
  const [clientErrors, setClientErrors] = useState<FollowUpErrors>({});
  /** Client validation first, then a backend rejection for the same field. */
  const errFor = (f: keyof FollowUpErrors) => clientErrors[f] ?? formError.fieldError(f);

  function openModal() {
    formError.clear();
    setClientErrors({});
    setOpen(true);
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    formError.clear();

    const fd = new FormData(e.currentTarget);
    const invalid = validateFollowUp({
      citizenName: String(fd.get("citizenName") ?? ""),
      citizenPhone: String(fd.get("citizenPhone") ?? ""),
      serviceType: String(fd.get("serviceType") ?? ""),
      subject: String(fd.get("subject") ?? ""),
      description: String(fd.get("description") ?? ""),
    });
    setClientErrors(invalid);
    if (Object.keys(invalid).length > 0) return;
    setSaving(true);
    const body = {
      citizenName: fd.get("citizenName"),
      citizenPhone: (fd.get("citizenPhone") as string)?.trim() || undefined,
      serviceType: fd.get("serviceType"),
      subject: fd.get("subject"),
      description: (fd.get("description") as string)?.trim() || undefined,
      priority: fd.get("priority"),
      relatedAccountId: accountId,
    };

    try {
      const res = await fetch("/api/proxy/v1/crm/service-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        await formError.fromResponse(res, "save");
        setSaving(false);
        return;
      }
      const { data } = (await res.json()) as { data: { id: string } };
      setOpen(false);
      router.push(`/crm/service-requests/${data.id}`);
    } catch (caught) {
      formError.fromException("save", caught);
      setSaving(false);
    }
  }

  return (
    <>
      <Button onClick={openModal}>
        {t("createFollowUp")}
      </Button>

      {/* GAP-CRM-HEALTH-ACCOUNTID-06: the dialog shell is now the shared ds
          Modal primitive (document.body portal, focus moved in + trapped,
          ESC-to-close, background made inert) instead of a hand-rolled
          position:fixed overlay with no focus trap. The form body is passed as
          children; the overlay only closes while not saving. */}
      <Modal
        open={open}
        onClose={() => { if (!saving) { setOpen(false); onClose?.(); } }}
        closeOnOverlayClick={!saving}
        size="md"
        title={t("createFollowUp")}
      >
        <div style={DIALOG}>
            <p
              style={{
                margin: "0 0 20px",
                fontSize: 13,
                color: "var(--mut)",
              }}
            >
              {t("accountLabel")}
              {accountName ? (
                <strong style={{ color: "var(--ink)" }}>{accountName}</strong>
              ) : (
                <code
                  style={{
                    fontSize: 12,
                    background: "var(--bg)",
                    padding: "1px 6px",
                    borderRadius: 4,
                  }}
                >
                  {accountId}
                </code>
              )}
            </p>

            {formError.message && (
              <div
                role="alert"
                style={{
                  marginBottom: 16,
                  padding: "10px 14px",
                  background:
                    "color-mix(in srgb, var(--bad) 10%, transparent)",
                  border: "1px solid var(--bad)",
                  borderRadius: "var(--r)",
                  color: "var(--bad)",
                  fontSize: 14,
                }}
              >
                {formError.message}
              </div>
            )}

            <form
              onSubmit={handleSubmit}
              noValidate
              style={{ display: "flex", flexDirection: "column", gap: 14 }}
            >
              <Field label={t("contactName")} required error={errFor("citizenName")}>
                <Input name="citizenName" maxLength={200} placeholder={t("contactNamePlaceholder")} />
              </Field>

              <Field label={t("phone")} error={errFor("citizenPhone")}>
                <Input name="citizenPhone" type="tel" maxLength={32} placeholder={t("phonePlaceholder")} />
              </Field>

              <Field label={t("serviceType")} required error={errFor("serviceType")}>
                <Select name="serviceType">
                  <option value="">{t("selectServiceType")}</option>
                  {/* GAP-CRM-HEALTH-ACCOUNTID-03: only account-relevant follow-up
                      types belong here. "New Water Connection" / "New Electricity
                      Connection" are citizen service-request types, not account
                      health actions, and mis-typed the resulting record. */}
                  <option value="Account Health Follow-up">
                    {t("typeAccountHealthFollowUp")}
                  </option>
                  <option value="Renewal Support">{t("typeRenewalSupport")}</option>
                  <option value="Escalation">{t("typeEscalation")}</option>
                  <option value="Other">{t("typeOther")}</option>
                </Select>
              </Field>

              <Field label={t("subject")} required error={errFor("subject")}>
                <Input
                  name="subject"
                  maxLength={500}
                  defaultValue={t("defaultSubject", { account: accountName ?? t("thisAccount") })}
                />
              </Field>

              <Field label={t("description")} error={errFor("description")}>
                <Textarea
                  name="description"
                  rows={3}
                  maxLength={5000}
                  placeholder={t("descriptionPlaceholder")}
                  style={{ resize: "vertical" }}
                />
              </Field>

              <Field label={t("priority")}>
                <Select name="priority" defaultValue="normal">
                  <option value="low">{t("priorityLow")}</option>
                  <option value="normal">{t("priorityNormal")}</option>
                  <option value="high">{t("priorityHigh")}</option>
                  <option value="urgent">{t("priorityUrgent")}</option>
                </Select>
              </Field>

              <div
                style={{
                  display: "flex",
                  gap: 10,
                  justifyContent: "flex-end",
                  marginTop: 4,
                }}
              >
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setOpen(false)}
                  disabled={saving}
                >
                  {t("cancel")}
                </Button>
                <Button
                  type="submit"
                  disabled={saving}
                  loading={saving}
                >
                  {saving ? t("creating") : t("createServiceRequest")}
                </Button>
              </div>
            </form>
        </div>
      </Modal>
    </>
  );
}
