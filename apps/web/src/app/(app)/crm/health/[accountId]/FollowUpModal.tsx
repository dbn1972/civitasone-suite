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
import { Button, Modal } from "@/app/_components/ds";

const DIALOG: React.CSSProperties = {
  padding: 0,
};

const FIELD: React.CSSProperties = {
  padding: "8px 12px",
  border: "1px solid var(--line)",
  borderRadius: "var(--r)",
  background: "var(--bg)",
  color: "var(--ink)",
  fontSize: 14,
  width: "100%",
  boxSizing: "border-box",
};

const LABEL: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
  fontSize: 14,
  color: "var(--ink)",
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

  function openModal() {
    formError.clear();
    setOpen(true);
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    formError.clear();

    const fd = new FormData(e.currentTarget);
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
              style={{ display: "flex", flexDirection: "column", gap: 14 }}
            >
              <label style={LABEL}>
                <span>
                  {t("contactName")}{" "}
                  <span aria-hidden="true" style={{ color: "var(--bad)" }}>
                    *
                  </span>
                </span>
                <input
                  name="citizenName"
                  required
                  maxLength={200}
                  placeholder={t("contactNamePlaceholder")}
                  style={FIELD}
                />
                {formError.fieldError("citizenName") && (
                  <span style={{ fontSize: 12, color: "var(--bad)" }}>{formError.fieldError("citizenName")}</span>
                )}
              </label>

              <label style={LABEL}>
                <span>{t("phone")}</span>
                <input
                  name="citizenPhone"
                  type="tel"
                  maxLength={32}
                  placeholder={t("phonePlaceholder")}
                  style={FIELD}
                />
              </label>

              <label style={LABEL}>
                <span>
                  {t("serviceType")}{" "}
                  <span aria-hidden="true" style={{ color: "var(--bad)" }}>
                    *
                  </span>
                </span>
                <select name="serviceType" required style={FIELD}>
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
                </select>
                {formError.fieldError("serviceType") && (
                  <span style={{ fontSize: 12, color: "var(--bad)" }}>{formError.fieldError("serviceType")}</span>
                )}
              </label>

              <label style={LABEL}>
                <span>
                  {t("subject")}{" "}
                  <span aria-hidden="true" style={{ color: "var(--bad)" }}>
                    *
                  </span>
                </span>
                <input
                  name="subject"
                  required
                  maxLength={500}
                  defaultValue={t("defaultSubject", { account: accountName ?? t("thisAccount") })}
                  style={FIELD}
                />
                {formError.fieldError("subject") && (
                  <span style={{ fontSize: 12, color: "var(--bad)" }}>{formError.fieldError("subject")}</span>
                )}
              </label>

              <label style={LABEL}>
                <span>{t("description")}</span>
                <textarea
                  name="description"
                  rows={3}
                  maxLength={5000}
                  placeholder={t("descriptionPlaceholder")}
                  style={{ ...FIELD, resize: "vertical" }}
                />
                {formError.fieldError("description") && (
                  <span style={{ fontSize: 12, color: "var(--bad)" }}>{formError.fieldError("description")}</span>
                )}
              </label>

              <label style={LABEL}>
                <span>{t("priority")}</span>
                <select name="priority" defaultValue="normal" style={FIELD}>
                  <option value="low">{t("priorityLow")}</option>
                  <option value="normal">{t("priorityNormal")}</option>
                  <option value="high">{t("priorityHigh")}</option>
                  <option value="urgent">{t("priorityUrgent")}</option>
                </select>
              </label>

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
