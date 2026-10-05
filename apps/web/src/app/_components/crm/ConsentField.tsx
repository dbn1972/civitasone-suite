"use client";

import { useId } from "react";
import { useTranslations } from "next-intl";
import { formatIndianDateTime } from "@/lib/formatters";

/**
 * GAP-CRM-CONTACTS-DETAIL-EDIT-07: a DPDP marketing-consent control that is more
 * than a bare checkbox. When consent is granted the operator must record the
 * PURPOSE and the CHANNEL it was captured through — the fields the crm-service
 * now stores and enforces (updateContactBody.consentRefiner). A read-only
 * "last recorded" line shows the exact instant the consent state last changed,
 * so the artefact is auditable rather than a lone boolean.
 *
 * Shared so the New and Edit contact forms capture an identical consent record.
 */

/** DPDP consent purposes — kept in lock-step with the crm-service enum/CHECK. */
export const CONSENT_PURPOSES = [
  { value: "marketing", label: "Marketing communications" },
  { value: "transactional", label: "Transactional messages" },
  { value: "service_updates", label: "Service updates" },
  { value: "research", label: "Research / surveys" },
] as const;

/** Channels consent could be captured through — in lock-step with the service. */
export const CONSENT_CHANNELS = [
  { value: "web_form", label: "Web form" },
  { value: "email", label: "Email" },
  { value: "phone", label: "Phone" },
  { value: "in_person", label: "In person" },
  { value: "import", label: "Bulk import" },
] as const;

export type ConsentValue = {
  granted: boolean;
  purpose: string;
  channel: string;
};

const inputStyle = { width: "100%", padding: 8, minHeight: 44, borderRadius: 8, border: "1px solid var(--line)" } as const;
const labelStyle = { display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4, fontWeight: 600 } as const;

export function ConsentField({
  value,
  onChange,
  lastRecordedAt,
  error,
}: {
  value: ConsentValue;
  onChange: (next: ConsentValue) => void;
  /** ISO timestamp of the last consent-state change, shown read-only. */
  lastRecordedAt?: string | null;
  /** Inline validation message (e.g. missing purpose/channel on grant). */
  error?: string;
}) {
  const t = useTranslations("crm.consent");
  const purposeId = useId();
  const channelId = useId();
  const errId = useId();

  return (
    <fieldset style={{ border: "1px solid var(--line)", borderRadius: 10, padding: 12, margin: 0 }}>
      <legend style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", padding: "0 6px" }}>
        {t("legend")}
      </legend>
      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
        <input
          type="checkbox"
          checked={value.granted}
          aria-describedby={error ? errId : undefined}
          onChange={(e) => onChange({ ...value, granted: e.target.checked })}
        />
        {t("grant")}
      </label>

      {value.granted ? (
        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", marginTop: 12 }}>
          <div>
            <label htmlFor={purposeId} style={labelStyle}>{t("purposeLabel")}</label>
            <select
              id={purposeId}
              value={value.purpose}
              aria-required="true"
              onChange={(e) => onChange({ ...value, purpose: e.target.value })}
              style={inputStyle}
            >
              <option value="">{t("selectPurpose")}</option>
              {CONSENT_PURPOSES.map((p) => (
                <option key={p.value} value={p.value}>{t(`purposes.${p.value}`)}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor={channelId} style={labelStyle}>{t("channelLabel")}</label>
            <select
              id={channelId}
              value={value.channel}
              aria-required="true"
              onChange={(e) => onChange({ ...value, channel: e.target.value })}
              style={inputStyle}
            >
              <option value="">{t("selectChannel")}</option>
              {CONSENT_CHANNELS.map((c) => (
                <option key={c.value} value={c.value}>{t(`channels.${c.value}`)}</option>
              ))}
            </select>
          </div>
        </div>
      ) : null}

      {error ? (
        <p id={errId} role="alert" style={{ fontSize: 12, color: "var(--bad)", marginTop: 8 }}>{error}</p>
      ) : null}

      {lastRecordedAt ? (
        <p style={{ fontSize: 11, color: "var(--muted)", marginTop: 8 }}>
          {t("lastRecorded", { when: formatIndianDateTime(lastRecordedAt) })}
        </p>
      ) : null}
    </fieldset>
  );
}
