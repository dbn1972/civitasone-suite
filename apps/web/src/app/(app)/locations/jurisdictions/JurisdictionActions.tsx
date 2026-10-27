"use client";

/**
 * GAP-LOCATIONS-JURISDICTIONS-02: assign and revoke jurisdictions. location-service has
 * POST /v1/jurisdictions (office + administrative unit + level + primary flag) and
 * DELETE /v1/jurisdictions/:id. Office and unit are picked by NAME (the options come from the offices
 * register and the administrative hierarchy), never typed as ids. Shown only to the roles the service
 * lets write. The service has no per-record read endpoint, so a write is reported as "received" with a
 * Refresh action rather than polled.
 */
import { useEffect, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { ActionButton, AcceptedNotice, Button, Card, Field, Select } from "../../../_components/ds";
import { useRegisterWrite } from "../_useRegisterWrite";
import type { NameOption } from "../_data";

export const JURISDICTION_LEVELS = ["state", "district", "block", "gp", "ward", "zone"] as const;
type Level = (typeof JURISDICTION_LEVELS)[number];

export function JurisdictionAssignForm({ offices, units }: { offices: NameOption[]; units: NameOption[] }) {
  const t = useTranslations("locationsOps.jurisdictions");
  const { request, accepted, formError } = useRegisterWrite("jurisdiction");
  const [officeId, setOfficeId] = useState("");
  const [unitId, setUnitId] = useState("");
  const [level, setLevel] = useState<Level>("district");
  const [isPrimary, setIsPrimary] = useState(false);
  const [localErrors, setLocalErrors] = useState<Record<string, string>>({});

  const err = (field: string) => localErrors[field] ?? formError.fieldError(field);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const problems: Record<string, string> = {};
    if (!officeId) problems.officeId = t("errOffice");
    if (!unitId) problems.unitId = t("errUnit");
    setLocalErrors(problems);
    if (Object.keys(problems).length > 0) return;
    await accepted.run(() => request("/v1/jurisdictions", "POST", { officeId, unitId, level, isPrimary }));
  }

  const { phase } = accepted;
  useEffect(() => {
    if (phase === "accepted") {
      setOfficeId(""); setUnitId(""); setLevel("district"); setIsPrimary(false);
    }
  }, [phase]);

  // Nothing to pick from: say so instead of showing a form that can never be submitted.
  if (offices.length === 0 || units.length === 0) {
    return (
      <Card title={t("manageTitle")}>
        <p className="pad" role="status" style={{ margin: 0 }}>{t("noOptions")}</p>
      </Card>
    );
  }

  return (
    <Card title={t("manageTitle")}>
      <form className="pad" onSubmit={(e) => void submit(e)} noValidate style={{ display: "grid", gap: 12, maxWidth: 520 }}>
        <Field label={t("officeLabel")} required error={err("officeId")}>
          <Select value={officeId} onChange={(e) => setOfficeId(e.target.value)}>
            <option value="">{t("choose")}</option>
            {offices.map((o) => (
              <option key={o.id} value={o.id}>{o.label}</option>
            ))}
          </Select>
        </Field>
        <Field label={t("unitLabel")} required error={err("unitId")}>
          <Select value={unitId} onChange={(e) => setUnitId(e.target.value)}>
            <option value="">{t("choose")}</option>
            {units.map((u) => (
              <option key={u.id} value={u.id}>{u.label}</option>
            ))}
          </Select>
        </Field>
        <Field label={t("levelLabel")} required error={err("level")}>
          <Select value={level} onChange={(e) => setLevel(e.target.value as Level)}>
            {JURISDICTION_LEVELS.map((v) => (
              <option key={v} value={v}>{t(`levels.${v}`)}</option>
            ))}
          </Select>
        </Field>
        <label style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 44 }}>
          <input type="checkbox" checked={isPrimary} onChange={(e) => setIsPrimary(e.target.checked)} />
          <span>{t("primaryLabel")}</span>
        </label>
        <div>
          <Button type="submit" disabled={accepted.isBusy} style={{ minHeight: 44 }}>
            {accepted.isBusy ? t("saving") : t("submit")}
          </Button>
        </div>
        <AcceptedNotice {...accepted.noticeProps} />
      </form>
    </Card>
  );
}

/** Per-row revoke: DELETE /v1/jurisdictions/:id behind a confirmation. */
export function JurisdictionRevoke({ id, office, unit }: { id: string; office: string; unit: string }) {
  const t = useTranslations("locationsOps.jurisdictions");
  const { request, accepted } = useRegisterWrite("jurisdiction");
  const unresolved = t("unresolved");
  return (
    <>
      <ActionButton
        label={t("revoke")}
        className="btn ghost"
        danger
        confirmTitle={t("revokeTitle")}
        confirmDescription={t("revokeDescription", { office: office || unresolved, unit: unit || unresolved })}
        confirmLabel={t("revoke")}
        onConfirm={async () => { await request(`/v1/jurisdictions/${encodeURIComponent(id)}`, "DELETE"); }}
        onSuccess={() => void accepted.accept({})}
      />
      <AcceptedNotice {...accepted.noticeProps} />
    </>
  );
}
