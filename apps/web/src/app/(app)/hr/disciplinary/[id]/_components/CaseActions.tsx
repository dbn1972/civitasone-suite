"use client";

/**
 * GAP-HR-DISCIPLINARY-DETAIL-06: drives the disciplinary state machine from
 * the case page. Each button opens a ConfirmDialog carrying that
 * transition's own small form; the POST goes to the existing route
 * (disciplinary/routes.ts). Those commands are applied by a queue consumer,
 * so success copy says "submitted" and the page is refreshed (twice, since
 * the consumer lands a moment after the 200). The backend stays the
 * authority on every guard (state, role, creator/inquiry-officer
 * ownership); this only avoids offering buttons that would be refused.
 */
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Card, ConfirmDialog } from "@/app/_components/ds";
import { browserFetch, errorCodeFromResponse, errorMessageFromResponse } from "@/lib/api/browserClient";
import { humanizeStatus } from "@/lib/formatters";
import {
  ACTION_PATH,
  actionsForActor,
  normalizeProceeding,
  penaltyOptionsFor,
  type CaseActionKey,
} from "./caseActions";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const FINDINGS = ["guilty", "not_guilty", "partly_guilty"] as const;
const APPEAL_OUTCOMES = ["upheld", "modified", "set_aside"] as const;

type Values = Record<string, string>;

const inputStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "8px 10px",
  fontSize: 14,
  border: "1px solid var(--line, #cbd5e1)",
  borderRadius: 8,
  minHeight: 40,
};

/** Fields each action collects, and which are required. */
const FIELDS: Record<CaseActionKey, { name: string; kind: "text" | "date" | "select"; required: boolean; max?: number }[]> = {
  charge_memo: [
    { name: "chargeMemoRef", kind: "text", required: true, max: 200 },
    { name: "chargeMemoDate", kind: "date", required: true },
  ],
  inquiry: [
    { name: "inquiryOfficerName", kind: "text", required: true, max: 200 },
    { name: "inquiryAppointedDate", kind: "date", required: true },
  ],
  finding: [
    { name: "finding", kind: "select", required: true },
    { name: "findingDate", kind: "date", required: true },
  ],
  penalty: [
    { name: "penaltyType", kind: "select", required: true },
    { name: "penaltyDate", kind: "date", required: true },
    { name: "penaltyDetail", kind: "text", required: false, max: 2000 },
  ],
  appeal: [
    { name: "appealFiledDate", kind: "date", required: true },
    { name: "appealAuthority", kind: "text", required: true, max: 200 },
  ],
  appeal_decision: [
    { name: "appealOutcome", kind: "select", required: true },
    { name: "appealDecidedDate", kind: "date", required: true },
  ],
  close: [],
  drop: [],
};

/** The backend field the free-text note maps to (finding keeps its own findingNotes, up to 8000). */
const NOTE_FIELD: Record<CaseActionKey, string> = {
  charge_memo: "notes",
  inquiry: "notes",
  finding: "findingNotes",
  penalty: "notes",
  appeal: "notes",
  appeal_decision: "notes",
  close: "notes",
  drop: "notes",
};

export function buildPayload(action: CaseActionKey, values: Values, note: string | undefined): Record<string, string> | null {
  const body: Record<string, string> = {};
  for (const f of FIELDS[action]) {
    const v = (values[f.name] ?? "").trim();
    if (f.required && v === "") return null;
    if (f.kind === "date" && v !== "" && !DATE_RE.test(v)) return null;
    if (f.max !== undefined && v.length > f.max) return null;
    if (v !== "") body[f.name] = v;
  }
  if (note) body[NOTE_FIELD[action]] = note;
  return body;
}

export function CaseActions({
  caseId,
  status,
  proceedingType,
  roles,
  isOwner,
}: {
  caseId: string;
  status: string;
  proceedingType: string;
  roles: string[];
  isOwner: boolean;
}) {
  const t = useTranslations("disciplinaryActions");
  const router = useRouter();
  const [active, setActive] = useState<CaseActionKey | null>(null);
  const [values, setValues] = useState<Values>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const proceeding = normalizeProceeding(proceedingType);
  if (!proceeding) return null;
  const actions = actionsForActor(status, proceeding, roles, isOwner);

  function open(a: CaseActionKey) {
    setValues({});
    setError("");
    setNotice("");
    setActive(a);
  }

  async function submit(note: string | undefined) {
    if (!active) return;
    const body = buildPayload(active, values, note);
    if (!body) {
      setError(t("fixFields"));
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await browserFetch(`v1/hrms/disciplinary-cases/${caseId}/${ACTION_PATH[active]}`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const code = await errorCodeFromResponse(res);
        if (code === "NOT_CASE_OWNER") setError(t("errNotOwner"));
        else if (code === "WRONG_STATE") setError(t("errWrongState"));
        else if (code === "PENALTY_MISMATCH") setError(t("errPenaltyMismatch"));
        else setError(await errorMessageFromResponse(res));
        return;
      }
      setActive(null);
      setNotice(t("submitted"));
      router.refresh();
      timer.current = setTimeout(() => router.refresh(), 2000);
    } catch {
      setError(t("errNetwork"));
    } finally {
      setBusy(false);
    }
  }

  const set = (name: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setValues((v) => ({ ...v, [name]: e.target.value }));

  function optionsFor(name: string): { value: string; label: string }[] {
    if (name === "finding") return FINDINGS.map((v) => ({ value: v, label: t(`finding_${v}`) }));
    if (name === "appealOutcome") return APPEAL_OUTCOMES.map((v) => ({ value: v, label: t(`outcome_${v}`) }));
    if (name === "penaltyType") return penaltyOptionsFor(proceeding!).map((v) => ({ value: v, label: humanizeStatus(v) }));
    return [];
  }

  const requiredFilled = active
    ? FIELDS[active].every((f) => !f.required || (values[f.name] ?? "").trim() !== "")
    : false;

  if (!isOwner) {
    return (
      <Card title={t("heading")} padding>
        <p style={{ margin: 0, fontSize: 13, color: "var(--mut)" }}>{t("notOwner")}</p>
      </Card>
    );
  }

  return (
    <Card title={t("heading")} padding>
      {notice && <p role="status" style={{ margin: "0 0 10px", fontSize: 13, color: "var(--good, #166534)" }}>{notice}</p>}
      {actions.length === 0 ? (
        <p style={{ margin: 0, fontSize: 13, color: "var(--mut)" }}>{t("noneAvailable")}</p>
      ) : (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {actions.map((a) => (
            <Button key={a} variant={a === "drop" ? "danger" : "secondary"} onClick={() => open(a)}>
              {t(`actions.${a}.label`)}
            </Button>
          ))}
        </div>
      )}
      {active && (
        <ConfirmDialog
          open
          title={t(`actions.${active}.label`)}
          description={t(`actions.${active}.description`)}
          confirmLabel={t(`actions.${active}.confirm`)}
          danger={active === "drop"}
          requireReason={active === "drop"}
          optionalReason={active !== "drop"}
          reasonLabel={active === "drop" ? t("reasonLabel") : t("notesLabel")}
          maxReasonLength={active === "finding" ? 8000 : 2000}
          busy={busy}
          confirmDisabled={!requiredFilled}
          errorMessage={error}
          onConfirm={(note) => { void submit(note); }}
          onCancel={() => { if (!busy) setActive(null); }}
        >
          <div style={{ display: "grid", gap: 10, margin: "8px 0" }}>
            {FIELDS[active].map((f) => {
              const id = `disc-${active}-${f.name}`;
              return (
                <div key={f.name} style={{ display: "grid", gap: 4 }}>
                  <label htmlFor={id} style={{ fontSize: 13, fontWeight: 600 }}>
                    {t(`field_${f.name}`)}
                    {f.required && <span aria-hidden="true" style={{ color: "var(--bad, #b91c1c)" }}> *</span>}
                  </label>
                  {f.kind === "select" ? (
                    <select id={id} value={values[f.name] ?? ""} onChange={set(f.name)} aria-required={f.required} style={inputStyle}>
                      <option value="">{t("select")}</option>
                      {optionsFor(f.name).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  ) : (
                    <input
                      id={id}
                      type={f.kind === "date" ? "date" : "text"}
                      value={values[f.name] ?? ""}
                      onChange={set(f.name)}
                      maxLength={f.max}
                      aria-required={f.required}
                      style={inputStyle}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </ConfirmDialog>
      )}
    </Card>
  );
}
